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
      if (!custom) return "./config/config.yaml";

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

      console.warn("配置地址无效或非同源，已回退到默认配置 ./config/config.yaml");
      return "./config/config.yaml";
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
      const firstEngine = searchEngines[0] ? searchEngines[0].key : "";
      activeEngineKey = searchEngines.some((item) => item.key === wanted) ? wanted : firstEngine;
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
      if (!searchEngines.length) return null;
      return searchEngines.find((item) => item.key === activeEngineKey) || searchEngines[0] || null;
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
      const input = byId("search-input");
      if (!input) return;
      input.focus();
      if (typeof input.setSelectionRange === "function") {
        const len = String(input.value || "").length;
        try {
          input.setSelectionRange(len, len);
        } catch {
          // noop
        }
      }
    }

    function focusSearchInput() {
      const input = byId("search-input");
      if (!input) return false;
      input.focus();
      return true;
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
      input.focus();
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

    function setActiveEngine(nextKey, focusInput = false) {
      if (!nextKey) return false;
      if (!searchEngines.some((item) => item.key === nextKey)) return false;
      activeEngineKey = nextKey;
      writeLocalStorage(STORAGE_KEYS.engineKey, activeEngineKey);
      renderEngineTabs();
      updateSearchInputState();
      clearSearchTip();
      hideSiteSearchPanel();
      if (focusInput) {
        focusSearchInputCursorToEnd();
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
      return setActiveEngine(next.key, focusInput);
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

    function rebuildSiteSearchEntries(groups) {
      const source = Array.isArray(groups) ? groups : [];
      const entries = [];
      source.forEach((group) => {
        if (!group || !Array.isArray(group.links)) return;
        group.links.forEach((item) => {
          const title = String(item.title || item.name || "").trim();
          const desc = String(item.desc || item.description || "").trim();
          const url = normalizeLinkUrl(item.url);
          if (!url) return;
          entries.push({
            title: title || url,
            desc,
            url,
            searchText: `${title} ${desc} ${url}`.toLowerCase()
          });
        });
      });
      siteSearchEntries = entries;
    }

    function findSiteMatches(keyword) {
      const target = String(keyword || "").trim().toLowerCase();
      if (!target || !siteSearchEntries.length) return [];
      return siteSearchEntries
        .filter((entry) => entry.searchText.includes(target))
        .map((entry) => ({
          title: entry.title,
          url: entry.url,
          desc: entry.desc
        }));
    }

    function getGroupAnchor(index) {
      return `bookmark-section-${index}`;
    }

    function setActiveGroupAnchor(anchor) {
      activeGroupAnchor = anchor;
      const tabs = byId("group-tabs");
      if (!tabs) return;
      tabs.querySelectorAll("button[data-group-anchor]").forEach((button) => {
        button.classList.toggle("active", button.dataset.groupAnchor === anchor);
      });
    }

    function clearBookmarkHoverState() {
      if (bookmarkHoverTimer) {
        clearTimeout(bookmarkHoverTimer);
        bookmarkHoverTimer = 0;
      }
      if (hoveredSiteCard && hoveredSiteCard.classList) {
        hoveredSiteCard.classList.remove("is-hover");
      }
      hoveredSiteCard = null;
    }

    function activateBookmarkHover(card) {
      if (!card || card === hoveredSiteCard) return;
      if (hoveredSiteCard && hoveredSiteCard.classList) {
        hoveredSiteCard.classList.remove("is-hover");
      }
      hoveredSiteCard = card;
      hoveredSiteCard.classList.add("is-hover");
    }

    function initBookmarkHoverInteractions() {
      const container = byId("bookmark-sections");
      if (!container) return;

      const canHover = !!(window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches);
      if (!canHover) {
        clearBookmarkHoverState();
        return;
      }

      if (container.dataset.boundBookmarkHover === "1") return;
      container.dataset.boundBookmarkHover = "1";

      container.addEventListener("pointerover", (event) => {
        const target = event.target;
        const card = target && target.closest ? target.closest(".site-card") : null;
        if (!card || !container.contains(card)) return;

        const from = event.relatedTarget;
        if (from && card.contains(from)) return;

        if (bookmarkHoverTimer) {
          clearTimeout(bookmarkHoverTimer);
        }
        bookmarkHoverTimer = setTimeout(() => {
          bookmarkHoverTimer = 0;
          activateBookmarkHover(card);
        }, 40);
      });

      container.addEventListener("pointerleave", () => {
        clearBookmarkHoverState();
      });
    }

    function applyBookmarkFilters(groups) {
      const bookmarks = isPlainObject(appConfig.bookmarks) ? appConfig.bookmarks : {};
      let filtered = Array.isArray(groups) ? groups.slice() : [];

      const visible = Array.isArray(bookmarks.visibleGroups)
        ? bookmarks.visibleGroups.map((name) => String(name).trim()).filter(Boolean)
        : [];
      if (visible.length) {
        const visibleSet = new Set(visible);
        filtered = filtered.filter((group) => visibleSet.has(String(group.name || group.group || "").trim()));
      }

      const exclude = Array.isArray(bookmarks.excludeGroups)
        ? bookmarks.excludeGroups.map((name) => String(name).trim()).filter(Boolean)
        : [];
      if (exclude.length) {
        const excludeSet = new Set(exclude);
        filtered = filtered.filter((group) => !excludeSet.has(String(group.name || group.group || "").trim()));
      }

      const maxLinks = Number(bookmarks.maxLinksPerGroup);
      if (Number.isFinite(maxLinks) && maxLinks > 0) {
        filtered = filtered.map((group) => {
          const links = Array.isArray(group.links) ? group.links.slice(0, maxLinks) : [];
          return Object.assign({}, group, { links });
        });
      }

      return filtered;
    }

    function renderEngineTabs() {
      const wrapper = byId("engine-tabs");
      if (!wrapper) return;
      if (!searchEngines.length) {
        setNodeHtml(wrapper, "");
        return;
      }

      const html = searchEngines.map((engine) => {
        const isActive = engine.key === activeEngineKey;
        const cls = isActive ? "engine-tab active" : "engine-tab";
        return `<button class="${cls}" type="button" data-engine="${escapeHtml(engine.key)}">${escapeHtml(engine.name)}</button>`;
      }).join("");
      setNodeHtml(wrapper, html);

      wrapper.querySelectorAll("button[data-engine]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const fallback = searchEngines[0] ? searchEngines[0].key : "";
          setActiveEngine(btn.dataset.engine || activeEngineKey || fallback, true);
        });
      });
    }

    function updateSearchInputState() {
      const input = byId("search-input");
      const icon = byId("engine-icon");
      const fallback = byId("engine-icon-fallback");
      const engine = getActiveEngine();
      if (!input || !icon || !fallback) return;

      if (!engine) {
        input.placeholder = "未配置可用搜索引擎";
        fallback.textContent = "无";
        fallback.style.display = "inline";
        icon.style.display = "none";
        return;
      }

      const fallbackText = engine.iconText || engine.name.slice(0, 1);
      const iconClass = String(engine.iconClass || "").trim();

      input.placeholder = engine.placeholder || `在 ${engine.name} 中搜索`;
      if (!iconClass) {
        fallback.textContent = fallbackText;
        fallback.style.display = "inline";
        icon.style.display = "none";
        return;
      }

      icon.className = iconClass;
      fallback.style.display = "none";
      icon.style.display = "inline-block";
      if (!isSiteLocalEngine(engine)) {
        hideSiteSearchPanel();
      }
    }

    function initSearch() {
      if (!searchEngines.length) return;

      const stored = readLocalStorage(STORAGE_KEYS.engineKey);
      if (stored && searchEngines.some((item) => item.key === stored)) {
        activeEngineKey = stored;
      } else if (!activeEngineKey) {
        activeEngineKey = searchEngines[0].key;
      }

      renderEngineTabs();
      updateSearchInputState();
      const searchShell = document.querySelector(".search-shell");

      const form = byId("search-form");
      if (form && form.dataset.boundSubmit !== "1") {
        form.dataset.boundSubmit = "1";
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          const input = byId("search-input");
          if (!input) return;
          const keyword = input.value.trim();
          clearSearchTip();
          if (!keyword) {
            hideSiteSearchPanel();
            focusSearchInput();
            setSearchTip("请输入关键词后再搜索", true);
            return;
          }

          const engine = getActiveEngine();
          if (!engine) return;

          if (isSiteLocalEngine(engine)) {
            renderSiteSearchPanel(keyword);
            return;
          }

          hideSiteSearchPanel();
          const url = buildSearchUrl(engine, keyword);
          if (url) {
            window.open(url, "_blank", "noopener,noreferrer");
          }
        });
      }

      const input = byId("search-input");
      if (input && input.dataset.boundSearchInput !== "1") {
        input.dataset.boundSearchInput = "1";
        input.addEventListener("input", () => {
          clearSearchTip();
          if (!isSiteLocalEngine()) {
            hideSiteSearchPanel();
            return;
          }
          scheduleSiteSearchPanelRender(input.value);
        });
        input.addEventListener("focus", () => {
          if (!isSiteLocalEngine()) return;
          renderSiteSearchPanel(input.value);
        });
        input.addEventListener("keydown", (event) => {
          if (!isSiteLocalEngine()) return;
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          const panel = byId("site-search-panel");
          if (!panel || panel.hidden) {
            renderSiteSearchPanel(input.value);
          }
          const items = getSiteSearchItems();
          if (!items.length) return;
          event.preventDefault();
          if (event.key === "ArrowDown") {
            focusSiteSearchItemByIndex(0);
            return;
          }
          focusSiteSearchItemByIndex(items.length - 1);
        });
      }

      const panel = byId("site-search-panel");
      if (panel && panel.dataset.boundSiteSearchKeyNav !== "1") {
        panel.dataset.boundSiteSearchKeyNav = "1";
        panel.addEventListener("keydown", (event) => {
          const target = event.target;
          const item = target && target.closest ? target.closest("a.site-search-item") : null;
          if (!item || !panel.contains(item)) return;

          const items = getSiteSearchItems();
          if (!items.length) return;
          const index = items.indexOf(item);
          if (index < 0) return;

          if (event.key === "ArrowDown") {
            event.preventDefault();
            if (index >= items.length - 1) {
              focusSearchInputCursorToEnd();
              return;
            }
            focusSiteSearchItemByIndex(index + 1);
            return;
          }

          if (event.key === "ArrowUp") {
            event.preventDefault();
            if (index <= 0) {
              focusSearchInputCursorToEnd();
              return;
            }
            focusSiteSearchItemByIndex(index - 1);
            return;
          }

          if (event.key === "Home") {
            event.preventDefault();
            focusSiteSearchItemByIndex(0);
            return;
          }

          if (event.key === "End") {
            event.preventDefault();
            focusSiteSearchItemByIndex(items.length - 1);
          }
        });
      }

      if (document.body.dataset.boundSearchShortcut !== "1") {
        document.body.dataset.boundSearchShortcut = "1";
        document.addEventListener("keydown", (event) => {
          if (event.ctrlKey || event.metaKey || event.altKey) return;
          if (event.isComposing) return;
          const target = event.target;
          const tag = target && target.tagName ? target.tagName.toLowerCase() : "";
          const isSearchInput = !!(target && target.id === "search-input");
          const isEditable = target && (target.isContentEditable || tag === "input" || tag === "textarea");

          if (event.key === "Tab") {
            if (isEditable && !isSearchInput) return;
            event.preventDefault();
            switchActiveEngineByOffset(event.shiftKey ? -1 : 1, true);
            return;
          }

          if (isEditable) return;
          if (event.key.length !== 1) return;
          event.preventDefault();
          focusSearchInputAndInsertText(event.key);
        });
      }

      if (document.body.dataset.boundSiteSearchPanelDismiss !== "1") {
        document.body.dataset.boundSiteSearchPanelDismiss = "1";
        document.addEventListener("click", (event) => {
          if (!searchShell) return;
          const target = event.target;
          if (target && searchShell.contains(target)) return;
          hideSiteSearchPanel();
        });
      }

      if (document.body.dataset.boundSiteSearchEsc !== "1") {
        document.body.dataset.boundSiteSearchEsc = "1";
        document.addEventListener("keydown", (event) => {
          if (event.key === "Escape") {
            const panel = byId("site-search-panel");
            const target = event.target;
            const inPanel = !!(panel && target && panel.contains(target));
            hideSiteSearchPanel();
            if (inPanel) {
              event.preventDefault();
              focusSearchInputCursorToEnd();
            }
          }
        });
      }
    }

    function renderGroupTabs() {
      const wrapper = byId("group-tabs");
      if (!wrapper) return;
      if (!allGroups.length) {
        setNodeHtml(wrapper, "");
        return;
      }

      setNodeHtml(wrapper, allGroups.map((group, index) => {
        const name = escapeHtml(String(group.name || group.group || `分组 ${index + 1}`));
        const anchor = getGroupAnchor(index);
        const cls = anchor === activeGroupAnchor ? "group-tab active" : "group-tab";
        return `<button class="${cls}" type="button" data-group-anchor="${anchor}">${name}</button>`;
      }).join(""));

      wrapper.querySelectorAll("button[data-group-anchor]").forEach((button) => {
        button.addEventListener("click", () => {
          const anchor = button.dataset.groupAnchor || "";
          if (!anchor) return;
          writeLocalStorage(STORAGE_KEYS.groupAnchor, anchor);
          setActiveGroupAnchor(anchor);
          const section = byId(anchor);
          if (section) {
            section.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        });
      });
    }

    function renderBookmarks() {
      const container = byId("bookmark-sections");
      if (!container) return;
      if (!allGroups.length) {
        container.innerHTML = `<div class="empty">没有可展示的书签分组。</div>`;
        return;
      }

      const sourceHint = escapeHtml(String((appConfig.bookmarks && appConfig.bookmarks.source) || "").trim());

      container.innerHTML = allGroups.map((group, index) => {
        const groupName = escapeHtml(String(group.name || group.group || `分组 ${index + 1}`));
        const links = Array.isArray(group.links) ? group.links : [];
        const anchor = getGroupAnchor(index);

        const cards = links.map((item) => {
          const title = String(item.title || item.name || "未命名");
          const url = safeHttpUrl(item.url);
          const desc = String(item.desc || item.description || "点击访问");
          return `
            <a class="site-card" data-group-anchor="${anchor}" href="${url}" target="_blank" rel="noopener noreferrer">
              <span class="site-icon">${firstChar(title)}</span>
              <span>
                <span class="site-title">${escapeHtml(title)}</span>
                <span class="site-desc">${escapeHtml(desc)}</span>
              </span>
            </a>
          `;
        }).join("");

        const body = cards
          ? `<div class="site-grid">${cards}</div>`
          : `<div class="empty">当前分组暂无书签，你可以在 ${sourceHint} 里新增 links。</div>`;
        return `
          <section class="bookmark-section" id="${anchor}">
            <h2 class="bookmark-section-head"><i class="iconfont icon-tag" aria-hidden="true"></i><span>${groupName}</span></h2>
            ${body}
          </section>
        `;
      }).join("");
    }

    async function loadBookmarks(options = {}) {
      const currentToken = ++bookmarkLoadToken;
      const shouldRender = options.render !== false;
      const bookmarks = isPlainObject(appConfig.bookmarks) ? appConfig.bookmarks : {};
      const sourcePath = String(bookmarks.source || "").trim();
      const sourceUrl = resolveConfigRelativeUrl(sourcePath);
      try {
        const requestTimeoutMs = normalizeTimeoutMs(bookmarks.requestTimeoutMs, DEFAULT_TIMEOUT_MS);
        const rawText = await fetchTextNoCache(sourceUrl, requestTimeoutMs);
        if (currentToken !== bookmarkLoadToken) return;
        const parsed = parseBookmarkSource(rawText, sourceUrl);
        const normalizedGroups = normalizeBookmarkGroups(parsed.groups);
        allGroups = applyBookmarkFilters(normalizedGroups);
        rebuildSiteSearchEntries(allGroups);
      } catch (error) {
        if (currentToken !== bookmarkLoadToken) return;
        console.warn(error);
        allGroups = [];
        rebuildSiteSearchEntries([]);
      }

      if (currentToken !== bookmarkLoadToken) return;
      if (!shouldRender) return;

      if (!allGroups.length) {
        clearBookmarkHoverState();
        const bookmarkSections = byId("bookmark-sections");
        if (bookmarkSections) {
          bookmarkSections.innerHTML = `<div class="empty">没有可展示的书签分组。</div>`;
        }
        const tabs = byId("group-tabs");
        if (tabs) {
          tabs.innerHTML = "";
        }
        return;
      }

      renderBookmarks();
      const storedAnchor = readLocalStorage(STORAGE_KEYS.groupAnchor);
      const fallbackAnchor = getGroupAnchor(0);
      activeGroupAnchor = storedAnchor && byId(storedAnchor) ? storedAnchor : fallbackAnchor;
      renderGroupTabs();
      setActiveGroupAnchor(activeGroupAnchor);
      initBookmarkHoverInteractions();
    }

    function toHotItem(item) {
      const title = String(
        item.title ||
        item.name ||
        item.repo_name ||
        item.full_name ||
        item.word ||
        item.keyword ||
        item.hotword ||
        "\u672A\u547D\u540D\u8BDD\u9898"
      );
      const rawUrl = String(
        item.url ||
        item.link ||
        item.href ||
        item.mobilUrl ||
        ""
      );
      let url = normalizeLinkUrl(rawUrl);
      if (!url && item.repo_name && /^[^/]+\/[^/]+$/.test(String(item.repo_name))) {
        url = `https://github.com/${String(item.repo_name).trim()}`;
      }
      url = normalizeLinkUrl(url);
      const score =
        item.hot ||
        item.stars ||
        item.currentPeriodStars ||
        item.starsToday ||
        item.today_stars ||
        item.starIncrease ||
        item.star_increase ||
        item.score ||
        item.heat ||
        "";
      return {
        title,
        url,
        score: score ? String(score) : ""
      };
    }
    function normalizeHotItems(rawItems) {
      const items = Array.isArray(rawItems) ? rawItems : [];
      const seen = new Set();
      const normalized = [];

      items.forEach((item) => {
        const parsed = toHotItem(item);
        const title = String(parsed.title || "").trim();
        if (!title) return;

        const url = normalizeLinkUrl(parsed.url);
        const key = `${title.toLowerCase()}|${url.toLowerCase()}`;
        if (seen.has(key)) return;
        seen.add(key);

        normalized.push({
          rank: normalized.length + 1,
          title,
          url,
          score: String(parsed.score || "").trim()
        });
      });

      return normalized;
    }

    function buildHotSourceQueue(preferredSource) {
      if (!preferredSource) return [];
      return [preferredSource].concat(hotSources.filter((item) => item.key !== preferredSource.key));
    }

    async function loadHotItemsBySource(source, token) {
      const targets = Array.isArray(source && source.targets) ? source.targets : [];
      let lastError = null;

      for (const target of targets) {
        try {
          const timeoutMs = normalizeTimeoutMs(target && target.timeoutMs, DEFAULT_HOT_TARGET_TIMEOUT_MS);
          const json = await fetchWithTimeout(
            String(target.url || "").trim(),
            timeoutMs,
            { cache: "no-store" }
          );
          if (token !== hotLoadToken) {
            return { items: [], aborted: true, lastError };
          }

          const items = normalizeHotItems(normalizeHotData(json));
          if (items.length) {
            return { items, aborted: false, lastError };
          }
        } catch (error) {
          lastError = error;
        }
      }

      return { items: [], aborted: false, lastError };
    }

    function renderHotSources() {
      const select = byId("hot-source");
      if (!select) return;
      if (!hotSources.length) {
        select.innerHTML = "";
        return;
      }

      select.innerHTML = hotSources.map((source) => {
        return `<option value="${escapeHtml(source.key)}">${escapeHtml(source.name)}</option>`;
      }).join("");

      const configDefault = String((appConfig.hot && appConfig.hot.defaultSource) || "");
      const stored = readLocalStorage(STORAGE_KEYS.hotSource);
      if (stored && hotSources.some((item) => item.key === stored)) {
        select.value = stored;
      } else if (configDefault && hotSources.some((item) => item.key === configDefault)) {
        select.value = configDefault;
      } else if (hotSources[0]) {
        select.value = hotSources[0].key;
      }
    }

    function renderHotList(items) {
      const list = byId("hot-list");
      if (!list) return;

      if (!items.length) {
        setNodeHtml(list, `<li class="empty">暂无热点数据，可切换来源后重试。</li>`);
        return;
      }

      const maxItems = Math.max(1, Number((appConfig.hot && appConfig.hot.maxItems) || 10) || 10);
      setNodeHtml(list, items.slice(0, maxItems).map((item) => {
        const rankClass = item.rank <= 3 ? "rank top3" : "rank";
        const meta = item.score ? `<span class="hot-meta">热度 ${escapeHtml(item.score)}</span>` : "";
        const body = `
          <span class="${rankClass}">${item.rank}</span>
          <span class="hot-name">${escapeHtml(item.title)}${meta}</span>
        `;
        if (!item.url) {
          return `
            <li>
              <span class="hot-item hot-item-static">
                ${body}
              </span>
            </li>
          `;
        }

        return `
          <li>
            <a class="hot-item" href="${safeHttpUrl(item.url)}" target="_blank" rel="noopener noreferrer">
              ${body}
            </a>
          </li>
        `;
      }).join(""));
    }

    async function loadHotList() {
      const sourceSelect = byId("hot-source");
      const status = byId("hot-status");
      const reload = byId("reload-hot");
      const currentToken = ++hotLoadToken;
      if (!sourceSelect || !status) return;

      sourceSelect.disabled = true;
      if (reload) reload.disabled = true;

      if (!hotSources.length) {
        renderHotList([]);
        status.textContent = "未配置热点源";
        status.classList.add("error");
        sourceSelect.disabled = false;
        if (reload) reload.disabled = false;
        return;
      }

      const preferred = hotSources.find((item) => item.key === sourceSelect.value) || hotSources[0];
      const queue = buildHotSourceQueue(preferred);

      status.classList.remove("error");
      let parsedList = [];
      let usedSource = null;
      let lastError = null;

      try {
        for (const source of queue) {
          if (currentToken !== hotLoadToken) return;
          status.textContent = `正在加载 ${source.name}`;

          const result = await loadHotItemsBySource(source, currentToken);
          if (result.aborted) return;
          if (result.lastError) {
            lastError = result.lastError;
          }

          if (result.items.length) {
            parsedList = result.items;
            usedSource = source;
            break;
          }
        }

        if (currentToken !== hotLoadToken) return;

        if (!parsedList.length || !usedSource) {
          throw lastError || new Error("热点源均不可用");
        }

        renderHotList(parsedList);
        if (usedSource.key !== preferred.key) {
          sourceSelect.value = usedSource.key;
          writeLocalStorage(STORAGE_KEYS.hotSource, usedSource.key);
          status.textContent = `${preferred.name} 不可用，已切换到 ${usedSource.name}`;
        } else {
          status.textContent = "";
        }
      } catch (error) {
        if (currentToken !== hotLoadToken) return;
        console.warn(error);
        renderHotList([]);
        status.textContent = "热点加载失败，请稍后重试";
        status.classList.add("error");
      } finally {
        if (currentToken === hotLoadToken) {
          sourceSelect.disabled = false;
          if (reload) reload.disabled = false;
        }
      }
    }

    function initHot() {
      if (!hotSources.length) return;
      renderHotSources();
      const select = byId("hot-source");
      const reload = byId("reload-hot");
      if (!select || !reload) return;

      if (select.dataset.boundChange !== "1") {
        select.dataset.boundChange = "1";
        select.addEventListener("change", () => {
          writeLocalStorage(STORAGE_KEYS.hotSource, select.value);
          loadHotList();
        });
      }

      if (reload.dataset.boundReload !== "1") {
        reload.dataset.boundReload = "1";
        reload.addEventListener("click", loadHotList);
      }
      loadHotList();
    }

    async function bootstrap() {
      try {
        await loadUserConfig();
      } catch (error) {
        console.error(error);
        const message = `配置加载失败：${error && error.message ? error.message : "未知错误"}`;
        const bookmarkContainer = byId("bookmark-sections");
        const status = byId("hot-status");
        if (bookmarkContainer) {
          bookmarkContainer.innerHTML = `<div class="empty">${escapeHtml(message)}</div>`;
        }
        if (status) {
          status.textContent = message;
          status.classList.add("error");
        }
        return;
      }
      applyUiConfig();

      const ui = isPlainObject(appConfig.ui) ? appConfig.ui : {};
      const shouldRenderBookmarks = ui.showBookmarks !== false;
      if (ui.showClock !== false) {
        updateTopClock();
        setInterval(updateTopClock, 1000);
      }

      const needsBookmarkData = shouldRenderBookmarks || (ui.showSearch !== false && searchEngines.some((engine) => engine.mode === "site-local"));
      if (needsBookmarkData) {
        await loadBookmarks({ render: shouldRenderBookmarks });
      }

      if (ui.showSearch !== false && searchEngines.length > 0) {
        initSearch();
      }

      if (ui.showHotPanel !== false && hotSources.length > 0) {
        initHot();
      }

      if (ui.showRegion !== false || ui.showWeather !== false) {
        loadRegionAndWeather();
      }
    }

    bootstrap();
