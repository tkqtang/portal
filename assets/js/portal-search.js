// Search input, engine switching, site-search, and keyboard shortcuts.
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

      const visible = normalizeStringList(bookmarks.visibleGroups);
      if (visible.length) {
        const visibleSet = new Set(visible);
        filtered = filtered.filter((group) => visibleSet.has(String(group.name || group.group || "").trim()));
      }

      const exclude = normalizeStringList(bookmarks.excludeGroups);
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

    function renderEmptyBookmarks(message = "没有可展示的书签分组。") {
      clearBookmarkHoverState();
      const bookmarkSections = byId("bookmark-sections");
      if (bookmarkSections) {
        bookmarkSections.innerHTML = `<div class="empty">${escapeHtml(String(message || ""))}</div>`;
      }
      const tabs = byId("group-tabs");
      if (tabs) {
        tabs.innerHTML = "";
      }
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

      if (wrapper.dataset.boundEngineClick !== "1") {
        wrapper.dataset.boundEngineClick = "1";
        wrapper.addEventListener("click", (event) => {
          const target = event.target;
          const button = target && target.closest ? target.closest("button[data-engine]") : null;
          if (!button || !wrapper.contains(button)) return;
          setActiveEngine(button.dataset.engine || "", { focusInput: true });
        });
      }
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
      activeEngineKey = pickExistingKey(searchEngines, stored, activeEngineKey);

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
