// Bookmarks, hot list, and application bootstrap.
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

      if (wrapper.dataset.boundGroupClick !== "1") {
        wrapper.dataset.boundGroupClick = "1";
        wrapper.addEventListener("click", (event) => {
          const target = event.target;
          const button = target && target.closest ? target.closest("button[data-group-anchor]") : null;
          if (!button || !wrapper.contains(button)) return;
          const anchor = button.dataset.groupAnchor || "";
          if (!anchor) return;
          writeLocalStorage(STORAGE_KEYS.groupAnchor, anchor);
          setActiveGroupAnchor(anchor);
          const section = byId(anchor);
          if (section) {
            section.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        });
      }
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
        renderEmptyBookmarks();
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

    function getPreferredHotSource(selectedKey) {
      return findItemByKey(hotSources, selectedKey) || (hotSources[0] || null);
    }

    function setHotControlsDisabled(disabled) {
      const sourceSelect = byId("hot-source");
      const reload = byId("reload-hot");
      if (sourceSelect) {
        sourceSelect.disabled = disabled;
      }
      if (reload) {
        reload.disabled = disabled;
      }
    }

    function setHotStatus(message, isError = false) {
      const status = byId("hot-status");
      if (!status) return;
      setNodeText(status, message);
      status.classList.toggle("error", !!message && isError === true);
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
      select.value = pickExistingKey(hotSources, stored, configDefault);
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
      const currentToken = ++hotLoadToken;
      if (!sourceSelect || !byId("hot-status")) return;

      setHotControlsDisabled(true);

      if (!hotSources.length) {
        renderHotList([]);
        setHotStatus("未配置热点源", true);
        setHotControlsDisabled(false);
        return;
      }

      const preferred = getPreferredHotSource(sourceSelect.value);
      if (!preferred) {
        renderHotList([]);
        setHotStatus("未配置热点源", true);
        setHotControlsDisabled(false);
        return;
      }
      const queue = buildHotSourceQueue(preferred);

      setHotStatus("", false);
      let parsedList = [];
      let usedSource = null;
      let lastError = null;

      try {
        for (const source of queue) {
          if (currentToken !== hotLoadToken) return;
          setHotStatus(`正在加载 ${source.name}`);

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
          setHotStatus(`${preferred.name} 不可用，已切换到 ${usedSource.name}`);
        } else {
          setHotStatus("");
        }
      } catch (error) {
        if (currentToken !== hotLoadToken) return;
        console.warn(error);
        renderHotList([]);
        setHotStatus("热点加载失败，请稍后重试", true);
      } finally {
        if (currentToken === hotLoadToken) {
          setHotControlsDisabled(false);
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
        renderEmptyBookmarks(message);
        setHotStatus(message, true);
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
