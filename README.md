# 纯静态导航页（YAML 配置版）

这是一个纯 `HTML + CSS + JavaScript` 的导航页项目，支持：

- 可切换搜索引擎
- 书签分组展示（`YAML`）
- 多源热点榜单
- 天气信息展示（可配置城市与接口）
- 明暗主题切换（太阳 / 月亮图标）

无需后端，直接部署到 Gitee Pages / GitHub Pages 即可运行。

## 目录说明

- `index.html`：页面结构、样式与全部逻辑
- `config.yaml`：站点全局配置（搜索引擎、热榜、天气、主题等）
- `links.yaml`：书签分组数据
- `assets/`：图标字体、背景图等静态资源

## 快速部署（Gitee Pages）

1. 新建仓库并上传以下文件：
   - `index.html`
   - `config.yaml`
   - `links.yaml`
   - `assets/`
2. 进入仓库 `服务 -> Gitee Pages`
3. 选择分支（`main` 或 `master`）和目录（`/`）
4. 启动构建并访问分配的 Pages 地址

## 配置文件

页面默认读取：`./config.yaml`

也可以通过 URL 参数指定：

`index.html?config=./config-dev.yaml`

## 书签文件

页面默认读取：`./links.yaml`

示例：

```yaml
groups:
  - name: "常用网站"
    links:
      - title: "Gitee"
        url: "https://gitee.com"
        desc: "代码托管与 Pages"
      - title: "GitHub"
        url: "https://github.com"
        desc: "开源仓库"
```

## 常用配置项

- `ui.showSearch/showBookmarks/showHotPanel/showClock/showRegion/showWeather`
- `ui.favicon`（例如 `./assets/favicon.png`）
- `search.defaultEngine`
- `search.engines[]`（`enabled/url/queryKey/params/mode`）
- `bookmarks.source`（建议 `./links.yaml`）
- `bookmarks.requestTimeoutMs`
- `bookmarks.visibleGroups / bookmarks.excludeGroups / bookmarks.maxLinksPerGroup`
- `hot.defaultSource / hot.maxItems / hot.sources[]`
- `weather.cityName / weather.weatherApiUrl`
- `theme.mode`（`auto/light/dark`）
- `theme.enableToggle`
- `theme.heroImageLight / theme.heroImageDark`

`hot.sources[].targets[].url` 支持日期占位符：

- `{today}`：当天日期（`YYYY-MM-DD`）
- `{today-slash}`：当天日期（`YYYY/MM/DD`）
- `{date-7}`：7 天前日期（`YYYY-MM-DD`，`N` 可替换为任意非负整数）
- `{date-7-slash}`：7 天前日期（`YYYY/MM/DD`，`N` 可替换为任意非负整数）

## 注意事项

- 项目是纯静态站点，不依赖后端。
- 热点与天气依赖外部接口，接口不可用时不会影响书签和搜索功能。
- 后续如接入中间件或 Git，可直接复用 `config.yaml` / `links.yaml` 作为统一数据源。

## 配置要求（2026-03-03）

- `index.html` 已移除内置默认配置，运行时完全依赖 `config.yaml`。
- `config.yaml` 必须是 YAML 对象，且需包含：`ui`、`theme`、`search`、`bookmarks`、`hot`、`weather`。
- `search.engines`、`hot.sources` 必须为数组，`bookmarks.source` 不能为空。
- 本项目本地配置与书签数据已统一为 YAML，不再支持 JSON 配置文件。
