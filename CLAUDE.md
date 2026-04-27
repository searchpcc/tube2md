# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

一个把 YouTube 视频字幕抽取为 Markdown（下载文件或复制到剪贴板）的 Chrome 扩展。Manifest V3，无构建步骤，纯原生 JS。

## 常用命令

- **本地加载**：在 `chrome://extensions` 打开开发者模式 → Load unpacked → 选本仓库根目录。
- **修改后调试**：直接改源文件，然后在扩展卡片上点刷新按钮。没有 lint / test / build 任务。
- **打包发布**：推一个 `v<semver>` tag（必须与 `manifest.json` 里的 `version` 完全一致），`.github/workflows/release.yml` 会校验版本、打 zip、发 GitHub Release。也可在 Actions 手动 `workflow_dispatch` 只出产物。
- **打包范围**：release 只包含 `manifest.json popup.html popup.js extractor.js icons _locales`，改动这些以外的文件不会进发布包。

## 架构

三段式，跨两个 JS 执行环境：

1. **popup.js（扩展环境）** — 打开弹窗时跑 `detectBoundary()`：通过 `chrome.scripting.executeScript({world:'MAIN', func: probeCaptions})` 注入探测函数，读 `#movie_player.getPlayerResponse().captions.playerCaptionsTracklistRenderer.captionTracks`，判断当前 tab 是否 watch 页、播放器是否就绪、是否有字幕轨。据此启用/禁用 `Extract` 按钮。点击后再注入 `extractAndDeliver`。
2. **extractor.js（页面 MAIN world）** — 真正干活的函数。负责自动打开字幕面板、解析 `ytd-transcript-segment-renderer`、按时间间隔合并段落、组装 Markdown、下载或复制。
3. **\_locales/{en,zh\_CN}/messages.json** — 所有 UI 字符串与错误消息；`manifest.json`、`popup.html`（`data-i18n` 属性）、`popup.js`（`chrome.i18n.getMessage`）都走这里。Chrome 根据浏览器 locale 自动选。

### 两个关键约束（改代码前务必理解）

- **extractor.js 必须完全自包含**。`chrome.scripting.executeScript({func})` 通过 `Function.prototype.toString()` 序列化后注入目标页，任何对 popup 作用域符号的闭包引用都会在页面里变成 `ReferenceError`。所有辅助函数都放在 `extractAndDeliver` 函数体内。
- **MAIN world 没有 `chrome.i18n`**。extractor 发生错误时返回 `{ok:false, errorKey, errorArgs}` 元组（**不是**已翻译好的字符串），由 popup.js 的 `translateError` 调 `chrome.i18n.getMessage` 翻译。新增错误分支时，要在 extractor 里抛出新 key，并在**两个** `_locales/*/messages.json` 里都加上该 key。

### 自动打开字幕面板的三段 fallback

YouTube 布局多变，`extractor.js` 按序尝试：

1. `ytd-video-description-transcript-section-renderer` 里的按钮 — **一定要钻到最内层的 `<button>`**。外层 `ytd-button-renderer` / `yt-button-shape` 包装元素上 `.click()` 不会触发 yt-button-shape 的 handler，是静默失败的高发点。
2. 展开折叠的描述区（`#description-inline-expander` 的 expand 按钮）后再走 1。
3. 视频 ⋯ "More actions" 菜单里找 "Show transcript" 菜单项。

三条路径都判断通过 `getSegments().length > 0`（即 `ytd-transcript-segment-renderer` 出现）。多语种按钮文本匹配在 `TRANSCRIPT_LABELS` 常量里，新增 locale 时往里加字串。

### 输出格式

- 文件名：`YYYYMMDD-title-slug-videoId.md`（发布日期从 `playerMicroformatRenderer.publishDate` 取；title slug 用 Unicode 字母/数字保留，截断到 60 字符）。
- 段落合并：按时间戳 gap 分段，gap 由弹窗传入（预设 `2.5 / 3.5 / 1.8 / 5.0`，用户可手填），默认 3.0 秒。
- 噪声过滤：`NOISE_RE` 移除 `[Music]` `[Applause]` 等标记。

## 提交 / 发布约定

- 仓库在 GitHub 上属于 `searchpcc`（见 manifest `homepage_url`）。发版本时先改 `manifest.json` 的 `version`，再打完全相同的 `v<version>` tag，否则 release workflow 会失败退出。
