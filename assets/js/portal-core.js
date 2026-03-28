// Shared state, config loading, parsing, theme, and network helpers.
let appConfig = {};
    let searchEngines = [];
    let hotSources = [];
    let allGroups = [];
    let siteSearchEntries = [];
    let activeGroupAnchor = "";
    let activeEngineKey = "";
    const STORAGE_KEYS = Object.freeze({
      themeMode: "themeMode",
      engineKey: "engineKey",
      groupAnchor: "groupAnchor",
      hotSource: "hotSource"
    });
    const THEME_STORAGE_KEY = STORAGE_KEYS.themeMode;
    let activeThemeMode = "light";
    let activeThemePreference = "auto";
    let bookmarkLoadToken = 0;
    let hotLoadToken = 0;
    let hoveredSiteCard = null;
    let bookmarkHoverTimer = 0;
    let siteSearchInputTimer = 0;
    let loadedConfigUrl = "";
    const DEFAULT_TIMEOUT_MS = 5000;
    const DEFAULT_HOT_TARGET_TIMEOUT_MS = 7000;
    const SITE_SEARCH_MAX_RESULTS = 12;
    const SITE_SEARCH_INPUT_DEBOUNCE_MS = 80;

    function byId(id) {
      return document.getElementById(id);
    }

    function setNodeHtml(node, html) {
      if (!node) return;
      node.innerHTML = html;
    }

    function setNodeText(node, text) {
      if (!node) return;
      node.textContent = String(text || "");
    }

    function setCssBackgroundVar(name, image) {
      const value = String(image || "").trim();
      const cssValue = value ? `url("${value.replace(/"/g, '\\"')}")` : "none";
      document.documentElement.style.setProperty(name, cssValue);
    }

    function readLocalStorage(key) {
      try {
        return String(localStorage.getItem(key) || "");
      } catch {
        return "";
      }
    }

    function writeLocalStorage(key, value) {
      try {
        localStorage.setItem(key, String(value));
      } catch {
        // noop
      }
    }

    function findItemByKey(list, key) {
      const targetKey = String(key || "").trim();
      if (!targetKey || !Array.isArray(list)) return null;
      return list.find((item) => item && String(item.key || "").trim() === targetKey) || null;
    }

    function pickExistingKey(list, ...candidates) {
      for (const candidate of candidates) {
        const match = findItemByKey(list, candidate);
        if (match) {
          return String(match.key || "");
        }
      }
      return Array.isArray(list) && list[0] ? String(list[0].key || "") : "";
    }

    function normalizeStringList(rawList) {
      return Array.isArray(rawList)
        ? rawList.map((item) => String(item || "").trim()).filter(Boolean)
        : [];
    }

    function focusNode(node, cursorToEnd = false) {
      if (!node || typeof node.focus !== "function") return false;
      try {
        node.focus({ preventScroll: true });
      } catch {
        node.focus();
      }
      if (cursorToEnd && typeof node.setSelectionRange === "function") {
        const len = String(node.value || "").length;
        try {
          node.setSelectionRange(len, len);
        } catch {
          // noop
        }
      }
      return true;
    }

    function normalizeThemeMode(value) {
      const mode = String(value || "").trim().toLowerCase();
      return mode === "dark" || mode === "light" || mode === "auto" ? mode : "auto";
    }

    function resolveThemeMode(mode) {
      if (mode === "auto") {
        if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
          return "dark";
        }
        return "light";
      }
      return mode === "dark" ? "dark" : "light";
    }

    function updateThemeToggleState() {
      const button = byId("theme-toggle");
      const icon = byId("theme-toggle-icon");
      if (!button || !icon) return;

      const isDark = activeThemeMode === "dark";
      icon.textContent = isDark ? "☽" : "☀";

      const nextLabel = isDark ? "切换到亮色模式" : "切换到暗色模式";
      button.setAttribute("aria-label", nextLabel);
      button.title = nextLabel;
    }

    function applyThemeMode(mode, persist = false) {
      const normalized = normalizeThemeMode(mode);
      activeThemePreference = normalized;
      activeThemeMode = resolveThemeMode(normalized);
      document.documentElement.setAttribute("theme-mode", activeThemeMode);
      updateThemeToggleState();
      if (persist) {
        writeLocalStorage(THEME_STORAGE_KEY, normalized);
      }
    }

    function initThemeToggle() {
      const button = byId("theme-toggle");
      if (!button) return;

      if (button.dataset.boundThemeClick !== "1") {
        button.dataset.boundThemeClick = "1";
        button.addEventListener("click", () => {
          const next = activeThemeMode === "dark" ? "light" : "dark";
          applyThemeMode(next, true);
        });
      }

      if (document.body.dataset.boundThemeMedia !== "1" && window.matchMedia) {
        document.body.dataset.boundThemeMedia = "1";
        const media = window.matchMedia("(prefers-color-scheme: dark)");
        const syncBySystem = () => {
          if (activeThemePreference === "auto") {
            applyThemeMode("auto");
          }
        };
        if (typeof media.addEventListener === "function") {
          media.addEventListener("change", syncBySystem);
        } else if (typeof media.addListener === "function") {
          media.addListener(syncBySystem);
        }
      }
    }

    function isPlainObject(value) {
      return Object.prototype.toString.call(value) === "[object Object]";
    }

    function assertConfigShape(config, sourceUrl) {
      if (!isPlainObject(config)) {
        throw new Error(`配置文件格式错误（${sourceUrl}）：根节点必须是对象`);
      }

      const requiredObjects = ["ui", "theme", "search", "bookmarks", "hot", "weather"];
      requiredObjects.forEach((key) => {
        if (!isPlainObject(config[key])) {
          throw new Error(`配置文件缺少对象字段（${sourceUrl}）：${key}`);
        }
      });

      if (!Array.isArray(config.search.engines)) {
        throw new Error(`配置文件字段错误（${sourceUrl}）：search.engines 必须是数组`);
      }

      if (!Array.isArray(config.hot.sources)) {
        throw new Error(`配置文件字段错误（${sourceUrl}）：hot.sources 必须是数组`);
      }

      const bookmarkSource = String(config.bookmarks.source || "").trim();
      if (!bookmarkSource) {
        throw new Error(`配置文件字段错误（${sourceUrl}）：bookmarks.source 不能为空`);
      }

      return config;
    }

    function fetchTextNoCache(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
      const raw = String(url || "").trim();
      if (!raw) {
        throw new Error("请求地址为空");
      }
      const joiner = raw.includes("?") ? "&" : "?";
      const requestUrl = `${raw}${joiner}v=${Date.now()}`;
      return fetchWithTimeout(
        requestUrl,
        timeoutMs,
        { cache: "no-store" },
        "text"
      );
    }

    function normalizeSearchEngines(rawList) {
      const list = Array.isArray(rawList) ? rawList : [];
      return list
        .filter((item) => item && item.enabled !== false && item.key && item.name)
        .map((item) => {
          const mode = item.mode === "site-local" ? "site-local" : "url";
          return {
            key: String(item.key),
            name: String(item.name),
            iconClass: String(item.iconClass || ""),
            iconText: String(item.iconText || String(item.name).slice(0, 1)),
            placeholder: String(item.placeholder || `在 ${item.name} 中搜索`),
            mode,
            url: String(item.url || ""),
            queryKey: String(item.queryKey || "q"),
            params: isPlainObject(item.params) ? item.params : {}
          };
        });
    }

    function normalizeHotSources(rawList) {
      const list = Array.isArray(rawList) ? rawList : [];
      return list
        .filter((source) => source && source.enabled !== false && source.key && source.name)
        .map((source) => {
          const targets = Array.isArray(source.targets) ? source.targets : [];
          const normalizedTargets = targets
            .filter((target) => target && target.enabled !== false && target.url)
            .map((target) => ({
              url: String(target.url),
              timeoutMs: normalizeTimeoutMs(target.timeoutMs, DEFAULT_HOT_TARGET_TIMEOUT_MS)
            }));
          return {
            key: String(source.key),
            name: String(source.name),
            targets: normalizedTargets
          };
        })
        .filter((source) => source.targets.length > 0);
    }

    function buildSearchUrl(engine, keyword) {
      if (!engine || engine.mode === "site-local") return "";
      const baseUrl = String(engine.url || "").trim();
      if (!baseUrl) return "";

      const queryKey = String(engine.queryKey || "q");
      const params = new URLSearchParams();
      params.set(queryKey, keyword);

      const extraParams = isPlainObject(engine.params) ? engine.params : {};
      Object.keys(extraParams).forEach((key) => {
        const value = extraParams[key];
        if (value === undefined || value === null || value === "") return;
        params.set(key, String(value));
      });

      try {
        const parsed = new URL(baseUrl, window.location.href);
        params.forEach((value, key) => {
          parsed.searchParams.set(key, value);
        });
        if (/^https?:$/i.test(parsed.protocol)) {
          return parsed.toString();
        }
      } catch {
        // noop
      }
      return "";
    }

    function buildWeatherUrl() {
      const weather = isPlainObject(appConfig.weather) ? appConfig.weather : {};

      const directUrl = String(weather.weatherApiUrl || weather.apiUrl || weather.url || "").trim();
      if (directUrl) return directUrl;

      const template = String(weather.weatherUrlTemplate || "").trim();
      const lat = Number(weather.latitude ?? weather.lat);
      const lon = Number(weather.longitude ?? weather.lon);
      if (!template || !Number.isFinite(lat) || !Number.isFinite(lon)) return "";

      return template
        .replace(/\{lat\}/g, encodeURIComponent(String(lat)))
        .replace(/\{lon\}/g, encodeURIComponent(String(lon)));
    }

    function getWeatherCityName() {
      const weather = isPlainObject(appConfig.weather) ? appConfig.weather : {};
      const val = String(weather.cityName || weather.city || "").trim();
      return val || "未知地区";
    }

    function resolveConfigUrl() {
      const params = new URLSearchParams(window.location.search);
      const custom = String(params.get("config") || "").trim();
      if (!custom) return "./config.yaml";

      try {
        const resolved = new URL(custom, window.location.href);
        const currentProtocol = String(window.location.protocol || "").toLowerCase();
        const isSameOriginHttp = /^https?:$/i.test(resolved.protocol) && resolved.origin === window.location.origin;
        const isLocalFile = currentProtocol === "file:" && resolved.protocol === "file:";
        if (isSameOriginHttp || isLocalFile) {
          return resolved.toString();
        }
      } catch {
        // noop
      }

      console.warn("配置地址无效或非同源，已回退到默认配置 ./config.yaml");
      return "./config.yaml";
    }

    function resolveAbsoluteUrl(pathOrUrl, baseUrl = window.location.href) {
      const raw = String(pathOrUrl || "").trim();
      if (!raw) return "";
      try {
        return new URL(raw, baseUrl).toString();
      } catch {
        return raw;
      }
    }

    function resolveConfigRelativeUrl(pathOrUrl) {
      return resolveAbsoluteUrl(pathOrUrl, loadedConfigUrl || window.location.href);
    }

    function applyRuntimeConfig() {
      searchEngines = normalizeSearchEngines(appConfig.search && appConfig.search.engines);
      hotSources = normalizeHotSources(appConfig.hot && appConfig.hot.sources);

      const wanted = String((appConfig.search && appConfig.search.defaultEngine) || "");
      activeEngineKey = pickExistingKey(searchEngines, wanted);
    }

    async function loadUserConfig() {
      const configUrl = resolveConfigUrl();
      loadedConfigUrl = resolveAbsoluteUrl(configUrl, window.location.href);
      const configRequestUrl = loadedConfigUrl || configUrl;
      const rawText = await fetchTextNoCache(configRequestUrl, DEFAULT_TIMEOUT_MS);
      const userConfig = parseConfigSource(rawText, configRequestUrl);
      appConfig = assertConfigShape(userConfig, configRequestUrl);
      applyRuntimeConfig();
    }

    function toggleNode(node, visible) {
      if (!node) return;
      node.classList.toggle("is-hidden", !visible);
    }

    function applyUiConfig() {
      const ui = isPlainObject(appConfig.ui) ? appConfig.ui : {};
      const theme = isPlainObject(appConfig.theme) ? appConfig.theme : {};
      const heroImageLight = theme.heroImageLight || theme.heroImage || "";
      const heroImageDark = theme.heroImageDark || theme.heroImageNight || heroImageLight || "";
      setCssBackgroundVar("--hero-image-light", heroImageLight);
      setCssBackgroundVar("--hero-image-dark", heroImageDark);

      const storedThemeRaw = readLocalStorage(THEME_STORAGE_KEY);
      const hasStoredTheme = storedThemeRaw === "light" || storedThemeRaw === "dark" || storedThemeRaw === "auto";
      const configuredThemeMode = normalizeThemeMode(theme.mode || ui.themeMode);
      applyThemeMode(hasStoredTheme ? storedThemeRaw : configuredThemeMode);
      initThemeToggle();
      const themeToggleVisible = theme.enableToggle !== false;
      toggleNode(byId("theme-toggle"), themeToggleVisible);
      const githubLinkNode = byId("github-link");
      const githubUrl = normalizeLinkUrl(ui.githubUrl || ui.github || "");
      const githubVisible = !!githubUrl;
      if (githubLinkNode) {
        if (githubVisible) {
          githubLinkNode.setAttribute("href", githubUrl);
        } else {
          githubLinkNode.removeAttribute("href");
        }
      }
      toggleNode(githubLinkNode, githubVisible);

      const title = String(ui.pageTitle || "").trim();
      if (title) {
        document.title = title;
      }
      applyConfiguredFavicon(String(ui.favicon || "").trim());

      const bookmarkTitle = String(ui.bookmarkTitle || "").trim();
      if (bookmarkTitle) {
        const bookmarkTitleNode = byId("bookmark-title-text");
        if (bookmarkTitleNode) {
          bookmarkTitleNode.textContent = bookmarkTitle;
        }
      }

      const clockNode = byId("clock-main");
      const regionNode = byId("region-main");
      const weatherNode = byId("weather-main");
      toggleNode(clockNode, ui.showClock !== false);
      toggleNode(regionNode, ui.showRegion !== false);
      toggleNode(weatherNode, ui.showWeather !== false);

      const topVisibleCount = [clockNode, regionNode, weatherNode]
        .filter((node) => node && !node.classList.contains("is-hidden"))
        .length;
      document.querySelectorAll(".top-sep").forEach((sep, index) => {
        sep.classList.toggle("is-hidden", index >= topVisibleCount - 1);
      });
      toggleNode(document.querySelector(".hero-top"), topVisibleCount > 0 || themeToggleVisible || githubVisible);

      const searchVisible = ui.showSearch !== false && searchEngines.length > 0;
      const bookmarksVisible = ui.showBookmarks !== false;
      const hotVisible = ui.showHotPanel !== false && hotSources.length > 0;
      toggleNode(document.querySelector(".search-shell"), searchVisible);
      toggleNode(document.querySelector(".bookmarks"), bookmarksVisible);
      toggleNode(document.querySelector(".hot-panel"), hotVisible);

      const main = document.querySelector(".main");
      if (main) {
        main.classList.toggle("single-column", !bookmarksVisible || !hotVisible);
      }

    }

    function escapeHtml(text) {
      return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function safeHttpUrl(url) {
      const raw = String(url || "").trim();
      return /^https?:\/\//i.test(raw) ? raw : "#";
    }

    function detectFaviconMimeType(url) {
      const value = String(url || "").toLowerCase().split(/[?#]/)[0];
      if (value.endsWith(".png")) return "image/png";
      if (value.endsWith(".svg")) return "image/svg+xml";
      if (value.endsWith(".ico")) return "image/x-icon";
      if (value.endsWith(".webp")) return "image/webp";
      if (value.endsWith(".jpg") || value.endsWith(".jpeg")) return "image/jpeg";
      return "image/x-icon";
    }

    function applyConfiguredFavicon(rawPath) {
      const path = String(rawPath || "").trim();
      if (!path) return;
      const resolved = resolveConfigRelativeUrl(path);
      if (!resolved) return;

      const link = byId("favicon-link") || document.querySelector("link[rel='icon']");
      if (!link) return;
      link.setAttribute("href", resolved);
      link.setAttribute("type", detectFaviconMimeType(resolved));
    }

    function normalizeTimeoutMs(raw, fallback = DEFAULT_TIMEOUT_MS) {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
      return Math.max(200, Math.min(Math.round(parsed), 120000));
    }

    function normalizeLinkUrl(rawUrl) {
      const value = String(rawUrl || "").trim();
      if (!value) return "";
      if (/^https?:\/\//i.test(value)) return value;
      if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:[/:?#].*)?$/i.test(value)) {
        return `https://${value}`;
      }
      return "";
    }

    function normalizeBookmarkGroups(rawGroups) {
      const groups = Array.isArray(rawGroups) ? rawGroups : [];
      return groups.map((group, index) => {
        const links = Array.isArray(group && group.links) ? group.links : [];
        const seen = new Set();

        const normalizedLinks = links.map((item) => {
          const rawTitle = String((item && (item.title || item.name)) || "").trim();
          const url = normalizeLinkUrl(item && item.url);
          if (!url) return null;

          const title = rawTitle || url;
          const dedupeKey = `${title.toLowerCase()}|${url.toLowerCase()}`;
          if (seen.has(dedupeKey)) return null;
          seen.add(dedupeKey);

          const desc = String((item && (item.desc || item.description)) || "").trim();
          return { title, url, desc };
        }).filter(Boolean);

        const name = String((group && (group.name || group.group)) || "").trim() || `分组 ${index + 1}`;
        return { name, links: normalizedLinks };
      });
    }

    function splitYamlKeyValue(text) {
      let quote = "";
      for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if ((ch === "'" || ch === "\"") && (i === 0 || text[i - 1] !== "\\")) {
          quote = quote === ch ? "" : (quote || ch);
          continue;
        }
        if (!quote && ch === ":") {
          return [text.slice(0, i), text.slice(i + 1)];
        }
      }
      return [text, ""];
    }

    function stripYamlInlineComment(text) {
      let quote = "";
      for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if ((ch === "'" || ch === "\"") && (i === 0 || text[i - 1] !== "\\")) {
          quote = quote === ch ? "" : (quote || ch);
          continue;
        }
        if (!quote && ch === "#" && (i === 0 || /\s/.test(text[i - 1]))) {
          return text.slice(0, i).trimEnd();
        }
      }
      return text;
    }

    function parseYamlScalar(raw) {
      const val = String(raw || "").trim();
      if (!val) return "";

      if ((val.startsWith("\"") && val.endsWith("\"")) || (val.startsWith("'") && val.endsWith("'"))) {
        return val.slice(1, -1);
      }

      const lower = val.toLowerCase();
      if (lower === "true") return true;
      if (lower === "false") return false;
      if (lower === "null" || val === "~") return null;
      if (val === "[]") return [];
      if (val === "{}") return {};
      if (/^-?\d+(\.\d+)?$/.test(val)) return Number(val);
      return val;
    }

    function getNextYamlMeaningfulLine(lines, startIndex) {
      for (let i = startIndex; i < lines.length; i += 1) {
        const normalizedLine = String(lines[i] || "").replace(/\t/g, "    ");
        if (!normalizedLine.trim()) continue;
        const cleanLine = stripYamlInlineComment(normalizedLine);
        if (!cleanLine.trim()) continue;
        return {
          indent: cleanLine.match(/^ */)[0].length,
          content: cleanLine.trim()
        };
      }
      return null;
    }

    function parseYamlDocument(rawText) {
      const blockedYamlKeys = new Set(["__proto__", "prototype", "constructor"]);
      function assertSafeYamlKey(rawKey) {
        const key = String(rawKey || "").trim();
        if (!key) return key;
        if (blockedYamlKeys.has(key.toLowerCase())) {
          throw new Error(`YAML 包含危险字段：${key}`);
        }
        return key;
      }

      function assignYamlValue(target, rawKey, value) {
        const key = assertSafeYamlKey(rawKey);
        if (!key) return;
        target[key] = value;
      }

      const text = String(rawText || "").replace(/^\uFEFF/, "");
      const lines = text.split(/\r?\n/);
      const firstLine = getNextYamlMeaningfulLine(lines, 0);
      const rootValue = firstLine && firstLine.content.startsWith("- ") ? [] : {};
      const stack = [{
        type: Array.isArray(rootValue) ? "array" : "object",
        value: rootValue,
        indent: -1
      }];

      function inferNestedContainer(indent, lineIndex) {
        const next = getNextYamlMeaningfulLine(lines, lineIndex + 1);
        if (next && next.indent > indent && next.content.startsWith("- ")) {
          return [];
        }
        return {};
      }

      for (let i = 0; i < lines.length; i += 1) {
        const normalizedLine = String(lines[i] || "").replace(/\t/g, "    ");
        if (!normalizedLine.trim()) continue;
        const cleanLine = stripYamlInlineComment(normalizedLine);
        if (!cleanLine.trim()) continue;

        const indent = cleanLine.match(/^ */)[0].length;
        const content = cleanLine.trim();

        while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
          stack.pop();
        }
        const frame = stack[stack.length - 1];
        if (!frame) continue;

        if (content.startsWith("- ")) {
          if (frame.type !== "array") continue;

          const rest = content.slice(2).trim();
          if (!rest) {
            const nested = inferNestedContainer(indent, i);
            frame.value.push(nested);
            if (nested && typeof nested === "object") {
              stack.push({
                type: Array.isArray(nested) ? "array" : "object",
                value: nested,
                indent
              });
            }
            continue;
          }

          const [rawKey, rawValue] = splitYamlKeyValue(rest);
          const key = String(rawKey || "").trim();
          const hasKeyValue = key && rest.includes(":");
          if (!hasKeyValue) {
            frame.value.push(parseYamlScalar(rest));
            continue;
          }

          const obj = {};
          frame.value.push(obj);

          const valueText = String(rawValue || "").trim();
          if (!valueText) {
            const nested = inferNestedContainer(indent, i);
            assignYamlValue(obj, key, nested);
            stack.push({ type: "object", value: obj, indent });
            if (nested && typeof nested === "object") {
              stack.push({
                type: Array.isArray(nested) ? "array" : "object",
                value: nested,
                indent: indent + 1
              });
            }
            continue;
          }

          assignYamlValue(obj, key, parseYamlScalar(rawValue));
          stack.push({ type: "object", value: obj, indent });
          continue;
        }

        const [rawKey, rawValue] = splitYamlKeyValue(content);
        const key = String(rawKey || "").trim();
        if (!key || !content.includes(":")) continue;
        if (frame.type !== "object") continue;

        const valueText = String(rawValue || "").trim();
        if (!valueText) {
          const nested = inferNestedContainer(indent, i);
          assignYamlValue(frame.value, key, nested);
          if (nested && typeof nested === "object") {
            stack.push({
              type: Array.isArray(nested) ? "array" : "object",
              value: nested,
              indent
            });
          }
          continue;
        }

        assignYamlValue(frame.value, key, parseYamlScalar(rawValue));
      }

      return rootValue;
    }

    function parseBookmarkSource(rawText, sourceUrl) {
      const text = String(rawText || "").replace(/^\uFEFF/, "").trim();
      if (!text) return { groups: [] };

      const lowerSource = String(sourceUrl || "").trim().toLowerCase();
      if (/\.json(?:[?#]|$)/i.test(lowerSource)) {
        throw new Error("书签文件仅支持 YAML (.yaml/.yml)");
      }
      if (text.startsWith("{") || text.startsWith("[")) {
        throw new Error("书签内容仅支持 YAML 格式");
      }
      const parsed = parseYamlDocument(text);
      if (Array.isArray(parsed)) {
        return { groups: parsed };
      }
      if (isPlainObject(parsed) && Array.isArray(parsed.groups)) {
        return { groups: parsed.groups };
      }
      if (isPlainObject(parsed) && Array.isArray(parsed.data)) {
        return { groups: parsed.data };
      }
      return { groups: [] };
    }

    function parseConfigSource(rawText, sourceUrl) {
      const text = String(rawText || "").replace(/^\uFEFF/, "").trim();
      if (!text) {
        throw new Error("配置文件内容为空");
      }

      const lowerSource = String(sourceUrl || "").trim().toLowerCase();
      if (/\.json(?:[?#]|$)/i.test(lowerSource)) {
        throw new Error("配置文件仅支持 YAML (.yaml/.yml)");
      }
      if (text.startsWith("{") || text.startsWith("[")) {
        throw new Error("配置内容仅支持 YAML 格式");
      }

      const ensureObject = (value) => {
        if (!isPlainObject(value)) {
          throw new Error("配置文件必须是对象结构");
        }
        return value;
      };
      return ensureObject(parseYamlDocument(text));
    }

    function normalizeHotData(raw) {
      if (!raw) return [];
      if (Array.isArray(raw)) return raw;
      if (isPlainObject(raw) && Array.isArray(raw.data)) return raw.data;
      if (isPlainObject(raw) && isPlainObject(raw.data) && Array.isArray(raw.data.rows)) return raw.data.rows;
      if (isPlainObject(raw) && Array.isArray(raw.list)) return raw.list;
      return [];
    }

    function firstChar(text) {
      const val = String(text || "").trim();
      return val ? escapeHtml(val.charAt(0).toUpperCase()) : "·";
    }

    function pad2(num) {
      return num < 10 ? `0${num}` : String(num);
    }

    function getActiveEngine() {
      return findItemByKey(searchEngines, activeEngineKey) || (searchEngines[0] || null);
    }

    function isSiteLocalEngine(engine = getActiveEngine()) {
      return !!engine && engine.mode === "site-local";
    }

    function setSearchTip(message, isError = false) {
      const tip = byId("search-tip");
      if (!tip) return;
      const text = String(message || "").trim();
      tip.textContent = text;
      tip.classList.toggle("error", !!text && isError === true);
    }

    function clearSearchTip() {
      setSearchTip("", false);
    }

    function clearSiteSearchInputTimer() {
      if (!siteSearchInputTimer) return;
      clearTimeout(siteSearchInputTimer);
      siteSearchInputTimer = 0;
    }

    function focusSearchInputCursorToEnd() {
      focusNode(byId("search-input"), true);
    }

    function focusSearchInput() {
      return focusNode(byId("search-input"), false);
    }

    function scrollPageToTop() {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }

    function focusSearchInputAndInsertText(text = "") {
      const input = byId("search-input");
      if (!input) return false;

      scrollPageToTop();
      focusNode(input, false);
      scrollPageToTop();
      requestAnimationFrame(scrollPageToTop);

      if (!text) return true;

      const start = typeof input.selectionStart === "number" ? input.selectionStart : input.value.length;
      const end = typeof input.selectionEnd === "number" ? input.selectionEnd : input.value.length;
      input.value = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
      const nextPos = start + text.length;
      if (typeof input.setSelectionRange === "function") {
        input.setSelectionRange(nextPos, nextPos);
      }
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }

    function setActiveEngine(nextKey, options = {}) {
      const engine = findItemByKey(searchEngines, nextKey);
      if (!engine) return false;

      activeEngineKey = String(engine.key || "");
      writeLocalStorage(STORAGE_KEYS.engineKey, activeEngineKey);

      if (options.renderTabs !== false) {
        renderEngineTabs();
      }
      updateSearchInputState();
      clearSearchTip();
      if (options.hideSiteSearch !== false) {
        hideSiteSearchPanel();
      }
      if (options.focusInput) {
        focusNode(byId("search-input"), options.cursorToEnd === true);
      }
      return true;
    }

    function switchActiveEngineByOffset(offset, focusInput = false) {
      if (!searchEngines.length) return false;
      const currentIndex = searchEngines.findIndex((item) => item.key === activeEngineKey);
      const baseIndex = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex = (baseIndex + offset + searchEngines.length) % searchEngines.length;
      const next = searchEngines[nextIndex];
      if (!next) return false;
      return setActiveEngine(next.key, { focusInput, cursorToEnd: focusInput });
    }

    function hideSiteSearchPanel() {
      clearSiteSearchInputTimer();
      const panel = byId("site-search-panel");
      if (!panel) return;
      panel.hidden = true;
      panel.innerHTML = "";
    }

    function getSiteSearchItems() {
      const panel = byId("site-search-panel");
      if (!panel || panel.hidden) return [];
      return Array.from(panel.querySelectorAll("a.site-search-item"));
    }

    function focusSiteSearchItemByIndex(index) {
      const items = getSiteSearchItems();
      if (!items.length) return false;
      const safeIndex = Math.max(0, Math.min(index, items.length - 1));
      const item = items[safeIndex];
      if (!item) return false;
      item.focus();
      item.scrollIntoView({ block: "nearest" });
      return true;
    }

    function scheduleSiteSearchPanelRender(keyword) {
      clearSiteSearchInputTimer();
      siteSearchInputTimer = setTimeout(() => {
        siteSearchInputTimer = 0;
        renderSiteSearchPanel(keyword);
      }, SITE_SEARCH_INPUT_DEBOUNCE_MS);
    }

    function renderSiteSearchPanel(keyword) {
      clearSiteSearchInputTimer();
      const panel = byId("site-search-panel");
      if (!panel) return 0;
      const engine = getActiveEngine();
      if (!isSiteLocalEngine(engine)) {
        hideSiteSearchPanel();
        return 0;
      }

      const text = String(keyword || "").trim();
      if (!text) {
        hideSiteSearchPanel();
        return 0;
      }

      const matches = findSiteMatches(text);
      if (!matches.length) {
        panel.hidden = false;
        panel.innerHTML = `<div class="site-search-empty">站内未找到匹配结果</div>`;
        return 0;
      }

      const shown = matches.slice(0, SITE_SEARCH_MAX_RESULTS);
      const listHtml = shown.map((item, index) => {
        const title = escapeHtml(item.title || item.url || "未命名站点");
        const desc = escapeHtml(String(item.desc || "").trim());
        const url = escapeHtml(safeHttpUrl(item.url));
        const meta = desc ? desc : url;
        return `
          <a class="site-search-item" href="${url}" target="_blank" rel="noopener noreferrer" role="listitem" aria-setsize="${matches.length}" aria-posinset="${index + 1}">
            <span class="site-search-title">${title}</span>
            <span class="site-search-url">${meta}</span>
          </a>
        `;
      }).join("");

      const moreHtml = matches.length > shown.length
        ? `<div class="site-search-more">共 ${matches.length} 条，仅展示前 ${shown.length} 条</div>`
        : "";
      panel.innerHTML = `${listHtml}${moreHtml}`;
      panel.hidden = false;
      return matches.length;
    }

    function weatherTextByCode(code) {
      const group = {
        0: "晴",
        1: "晴间多云",
        2: "多云",
        3: "阴",
        45: "雾",
        48: "雾",
        51: "毛毛雨",
        53: "小雨",
        55: "小雨",
        56: "冻雨",
        57: "冻雨",
        61: "小雨",
        63: "中雨",
        65: "大雨",
        66: "冻雨",
        67: "冻雨",
        71: "小雪",
        73: "中雪",
        75: "大雪",
        77: "雪粒",
        80: "阵雨",
        81: "阵雨",
        82: "暴雨",
        85: "阵雪",
        86: "阵雪",
        95: "雷雨",
        96: "雷雨冰雹",
        99: "雷雨冰雹"
      };
      return group[code] || "天气";
    }

    async function fetchWithTimeout(url, timeoutMs = DEFAULT_TIMEOUT_MS, requestOptions = {}, responseType = "json") {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), normalizeTimeoutMs(timeoutMs, DEFAULT_TIMEOUT_MS));
      try {
        const response = await fetch(url, Object.assign({}, requestOptions, { signal: controller.signal }));
        if (!response.ok) {
          throw new Error(`请求失败: ${response.status}`);
        }
        return responseType === "text" ? await response.text() : await response.json();
      } catch (error) {
        if (error && error.name === "AbortError") {
          throw new Error("请求超时");
        }
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }

    function updateTopClock() {
      const clockNode = byId("clock-main");
      if (!clockNode) return;
      const now = new Date();
      const dateLabel = `${pad2(now.getMonth() + 1)} 月 ${pad2(now.getDate())} 日`;
      const timeLabel = `${pad2(now.getHours())} 时 ${pad2(now.getMinutes())} 分 ${pad2(now.getSeconds())} 秒`;
      clockNode.textContent = `${dateLabel} ${timeLabel}`;
    }

    async function loadRegionAndWeather() {
      const regionNode = byId("region-main");
      const weatherNode = byId("weather-main");
      const ui = isPlainObject(appConfig.ui) ? appConfig.ui : {};
      const weather = isPlainObject(appConfig.weather) ? appConfig.weather : {};
      const showRegion = ui.showRegion !== false;
      const showWeather = ui.showWeather !== false;
      if (!showRegion && !showWeather) return;

      const cityName = getWeatherCityName();
      if (showRegion && regionNode) {
        regionNode.textContent = cityName;
      }
      if (showWeather && weatherNode) {
        weatherNode.textContent = "☁ 天气加载中";
      }

      if (!showWeather || !weatherNode) return;

      try {
        const weatherUrl = buildWeatherUrl();
        if (!weatherUrl) {
          weatherNode.textContent = "☁ 天气未知";
          return;
        }

        const weatherTimeout = normalizeTimeoutMs(
          weather.weatherRequestTimeoutMs,
          4500
        );
        const weatherPayload = await fetchWithTimeout(weatherUrl, weatherTimeout);
        const current = weatherPayload && (
          weatherPayload.current ||
          weatherPayload.current_weather ||
          (weatherPayload.data && (weatherPayload.data.current || weatherPayload.data.current_weather))
        );
        if (!current) {
          weatherNode.textContent = "☁ 天气未知";
          return;
        }

        const weatherCode = Number(current.weather_code ?? current.weathercode ?? current.weatherCode);
        const desc = weatherTextByCode(weatherCode);
        const tempValue = Number(current.temperature_2m ?? current.temperature ?? current.temp);
        const temp = Number.isFinite(tempValue) ? Math.round(tempValue) : null;
        weatherNode.textContent = temp === null ? `☁ ${desc}` : `☁ ${desc} ${temp}°C`;
      } catch (error) {
        console.warn(error);
        weatherNode.textContent = "☁ 天气未知";
      }
    }
