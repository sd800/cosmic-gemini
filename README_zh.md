<p align="center">
  <img src="extension/icons/icon-128.png" width="112" height="112" alt="Cosmic Gemini 标志">
</p>

<h1 align="center">Cosmic Gemini</h1>

<p align="center"><a href="README.md">English</a></p>

Cosmic Gemini 是一套个人使用的 Chrome 网页工具，让日常浏览更清爽、更可控。插件包含 Native Scroll、No Autoplay、Any Copy、Image Download、Video Download，以及收纳轻量功能的 Satellites。

## 功能介绍

### Native Scroll

Native Scroll 会拦截网页对滚轮和触控板手势的接管，同时保留普通控件和页面内可滚动区域的正常操作。强力模式适合处理反复恢复自定义滚动，或通过脚本模拟页面移动的网站。

背景：有些网页会用脚本替换 Chrome 原生滚动，导致触控板原本熟悉的手感突然变化，页面移动也变得难以预料。Native Scroll 让滚动重新遵循浏览器与系统的操作习惯。

### No Autoplay

No Autoplay 会阻止未经您操作便开始播放的视频和声音，您主动播放的媒体仍可正常使用。除非您允许所有网站或符合规则的网站自动播放声音，否则插件会继续拦截。强力模式会移除指定网站中的媒体元素。

背景：有些网页会在您尚未操作时突然播放视频或声音，打断阅读，也可能干扰正在播放的其他内容。No Autoplay 让媒体等到您主动操作后再开始播放。

### Any Copy

Any Copy 会恢复被网页禁用的文字选择与复制快捷键，并阻止网页替换复制内容或在其中加入推广文字。

Any Copy 强力模式是一项单独控制的阅读功能，可将网页整理为简洁的静态页面，让文字能够自由选择，图片也不会被遮挡。原网页会保留在下方，退出 Any Copy 强力模式后即可立即恢复。

背景：有些网站会禁止选择文字、拦截复制快捷键，或擅自向复制内容中加入无关文字。Any Copy 恢复网页原本应有的选择与复制操作。

### Image Download

Image Download 会查找当前标签页中的图片，并默认在 Chrome 侧边栏中打开专用工作区。原网页会保留在一旁，方便您预览、筛选、选择和下载图片。您也可以在设置中改用独立标签页，或从侧边栏打开完整页面。

插件可以识别响应式图片、延迟加载来源、链接中的原图、CSS 图片、开放式 Shadow DOM、框架、内嵌 SVG、Canvas 内容、结构化数据，以及当前会话中加载的图片。相关尺寸与格式会归入同一组，并默认推荐更接近原图的来源。

您还可以重新扫描页面、加载延迟出现的图片、截取当前页面的可见区域、保留原格式，或在本地转换兼容图片。选中的图片可以分别下载，也可以合并为一个 ZIP 文件。

### Video Download

Video Download 会查找当前标签页中可以下载的媒体，并直接打开格式列表。页面缩略图和标题可用于确认当前视频，清晰度菜单会为每档主要画质保留一个优先选项。来源提供兼容音轨时，还可以选择仅下载音频。

所选项目的编码、封装格式、时长和已知文件大小会显示在菜单下方。插件不会让清晰度列表堆满细项，也不会为了读取这些信息而预先下载媒体内容。

插件支持视频文件、HLS、DASH、分离的音视频轨道、字幕和直播片段。只有在您选择下载后，才会在本地合并视频流或音视频轨道。媒体仍在处理时，可使用红色取消按钮停止网络读取和本地处理，Chrome 不会开始下载该文件。

插件还会专门识别 YouTube、哔哩哔哩、Vimeo、Facebook、Instagram、OK、VK Video、Canva、iQIYI、TwitCasting、Osmosis、Kick、Chaturbate，以及采用兼容封装方式的 HLS 播放器。识别哔哩哔哩视频时，插件会读取页面已有的播放信息，必要时再查询公开视频信息，无需先让播放器开始播放。

视频查找仅在当前标签页的临时会话中运行。站内跳转不会中断，手动停止或离开该网站后会自动结束。

### Satellites

Satellites 收纳无需在控制窗口中直接操作、适合在后台完成的小功能。

#### Bili Daily Login

哔哩哔哩每天会向访问网站的登录账号发放一枚硬币。若要持续领取，原本需要您记得每天访问哔哩哔哩网站或应用一次。Bili Daily Login 会在 Chrome 可以运行时按北京时间每天 00:05 安排访问，自动领取当日硬币。

## 主要特性

- Native Scroll 与 No Autoplay 分别提供全局默认状态和当前网站的单独设置，并支持标准模式与强力模式
- Any Copy 与 Any Copy 强力模式分别管理各自的网站启用规则
- 按需查找图片，支持原图推荐、筛选、本地格式转换、区域截取和批量 ZIP 下载
- 按需查找视频，支持视频文件、HLS、DASH、本地音视频合并、字幕和专用网站识别
- Satellites 中的可选功能各自提供简明设置和隐私说明
- 支持 `example.com` 这样的精确主机名，以及 `*.example.com` 这样的通配规则
- 在四行极简控制窗口中成对管理当前页面，全部设置位于底部的独立一行
- 各项功能拥有独立设置页面，并提供带完整重置功能的全部设置导航页。页面之间可以直接切换，首次显示时也会直接使用已选语言
- 提供自然的 en-US 与 zh-CN 界面，并自动适配系统的浅色或深色外观
- 采用事件驱动，不轮询，也不常驻后台页面
- 不使用分析服务，不记录浏览历史或活动记录

## 安装

1. 克隆或下载本仓库。
2. 在 Chrome 中打开 `chrome://extensions`。
3. 开启**开发者模式**。
4. 点击**加载已解压的扩展程序**，选择本项目的 [`extension`](extension) 文件夹。

Chrome 会要求扩展访问 HTTP 与 HTTPS 页面，以便各项功能在普通网页脚本运行前开始工作。

## 使用方法

控制窗口采用紧凑的四行布局，每行放置两个相关的控制按钮。

### 当前网站

- 第一行排列 **Native Scroll** 和 **Native Scroll 强力模式**。
- 第二行排列 **No Autoplay** 和 **No Autoplay 强力模式**。
- 第三行排列 **Any Copy** 和 **Any Copy 强力模式**。
- 第四行排列 **Image Download** 和 **Video Download**。

Native Scroll 与 No Autoplay 的控制按钮只调整当前网站，不会改变全局默认状态。即使全局设置已关闭，也可以为当前网站单独启用功能。即使全局设置已开启，也可以单独停用。关闭当前网站的强力模式后，该网站会恢复使用标准模式。

Any Copy 与 Any Copy 强力模式可以分别为当前网站开启，也可以同时运行。关闭其中一项不会改变另一项，两组网站规则在同一个设置页面中分区管理。

### 下载会话

点击 Image Download，即可在当前标签页中开始查找图片。图片工作区默认在侧边栏中打开，也可以在设置中改用独立标签页。站内跳转不会中断当前会话，手动停止、关闭来源标签页或离开该网站后会自动结束。

点击 Video Download，即可在当前标签页中开始查找视频并打开格式列表。站内跳转不会中断当前会话，手动停止、关闭标签页或离开该网站后会自动结束。

### 设置与定时功能

**全部设置**位于底部的独立一行并靠右显示。紧凑的主控制窗口会暂时隐藏 Cosmic Gemini 名称。全部设置可进入各项功能的设置页面，也可以将全部设置和网站规则恢复为默认状态。

全部设置页面集中提供 Native Scroll、No Autoplay、Any Copy、Image Download、Video Download 与 Satellites 的入口。Bili Daily Login 默认关闭。开启后，会在电脑已唤醒且 Chrome 正在运行时按日程执行。

无论停用了多久，Chrome 下次可以运行时都只补做当天任务，不会逐日追补此前错过的日期。

Native Scroll 与 No Autoplay 的设置顺序保持一致。您可以先选择默认状态，再添加网站例外，最后仅为有需要的网站调整保护模式。No Autoplay 会将声音自动播放权限放在单独的区域中。

控制窗口中的功能按钮只使用中性色和蓝色。Any Copy 强力模式与其他一级功能在未启用时采用较清晰的中性色。Native Scroll 与 No Autoplay 的强力模式属于二级功能，会使用更低调的灰度。

蓝色表示该功能可以在当前标签页中工作。蓝色按钮带有背景时，表示功能已经开启，并可能继续影响页面显示或操作。Image Download 与 Video Download 的当前标签页会话开启后只显示蓝色，不添加背景。

Native Scroll 或 No Autoplay 在页面中实际执行拦截后，当前使用的标准模式或强力模式按钮会出现蓝色细外框。

浏览器工具栏中的 Cosmic Gemini 标志保持不变。原有绿色图标仍保留给工具栏的独立活动提示。

### 网站规则

`example.com` 仅匹配该主机名。`*.example.com` 同时匹配根域名及其所有子域名。控制窗口会保存当前网站的精确规则，设置页面还可以添加通配规则。

Native Scroll 与 No Autoplay 各自拥有一个全局默认状态，以及四组网站规则：始终启用、始终停用、使用强力模式和保留标准模式。

精确规则优先于通配规则，其次采用范围最具体的通配规则。范围相同时，单独停用优先于单独启用，标准模式优先于强力模式。因此，可以在较大范围的规则中继续设置更具体的例外。

控制窗口中的一级功能按钮只会添加或移除当前网站的启用状态，不会改变全局默认设置。强力模式按钮会在需要时为当前网站启用功能，并在强力模式与标准模式之间切换。

Any Copy 与 Any Copy 强力模式分别保存各自的网站启用规则。No Autoplay 在某个网站被停用后，该网站可以自动播放视频、音频和 Web Audio。

### 声音自动播放

No Autoplay 默认会直接拦截声音自动播放，不再显示网页询问框。您可以在设置中允许所有网站自动播放音频元素和 Web Audio，也可以为指定网站添加主机名规则。这些权限不会放行自动播放的视频。

## 隐私

Native Scroll、No Autoplay、Any Copy、Any Copy 强力模式、Image Download 和 Video Download 完全在本地运行。Cosmic Gemini 仅保存各项功能的设置、您选择的网站规则、No Autoplay 的声音自动播放设置，以及 Bili Daily Login 最近一次完成日期。保存的网站规则仅包含主机名，不包含完整网址。

Image Download 与 Video Download 只会在当前标签页的临时会话中将检测到的来源地址保存在 `chrome.storage.session`。会话结束后，这些地址会被删除。

Cosmic Gemini 不会记录浏览历史或活动记录，也不使用分析服务。Bili Daily Login 不会判断或记录您是否、何时打开哔哩哔哩。

开启 Bili Daily Login 后，后台日程仅在电脑已唤醒且 Chrome 正在运行时访问哔哩哔哩服务。它会直接使用 Chrome 中已有的登录状态，不会读取或保存您的哔哩哔哩密码。

## 兼容性

Cosmic Gemini 适用于 Chrome 120 及以上版本，支持 macOS、Windows 和 Linux。Chrome 不允许扩展在 `chrome://`、Chrome 应用商店和部分内置查看器中运行，因此 Cosmic Gemini 不会处理这些页面。

Image Download 与 Video Download 可以处理当前浏览器会话能够访问的兼容来源。Video Download 不会解密 DRM，也不会使用其他插件的私有规则服务、授权机制或付费功能校验。

## 开发

Cosmic Gemini 使用 Manifest V3，媒体处理所需的依赖均随插件保存在本地。项目架构参见 [技术设计](docs/TECHNICAL.md)，精简验证流程参见 [验证说明](docs/QA.md)。

```sh
npm test
npm run check
```

© 2026 Songming.org
