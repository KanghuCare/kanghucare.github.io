# 康护通 Kang Hutong 官网

从医院到家的长者照护企业官网：医院陪护、康复护理、居家照护与健康管理。纯静态站点（HTML、CSS、JS），无第三方依赖，国内外均可访问。中英双语，默认中文，右上角可切换。

## 页面

| 文件 | 内容 |
| --- | --- |
| `index.html` | 首页 |
| `services.html` | 服务项目：医院陪护、康复护理、居家照护、健康管理 |
| `how-it-works.html` | 服务流程、护理等级、收费标准、常见问题 |
| `locations.html` | 服务网点查询与医院合作 |
| `guides.html` | 照护知识 |
| `about.html` | 关于我们：理念、团队、平台、信息保护 |
| `news.html` | 新闻动态 |
| `careers.html` | 护工招聘与在线报名 |
| `book.html` | 在线预约与联系方式 |
| `privacy.html` | 隐私政策（模板，需法务审阅） |
| `404.html` | 页面未找到 |

## 主要功能

- **开场与动效**：首次访问时有约 1 秒的品牌开场（每次打开浏览器只出现一次）；标题逐行浮现、护理日报逐条出现、数字递增、区块依次进入。系统开启“减少动态效果”时全部自动关闭。
- **导航**：桌面端“服务项目”下拉展示四项服务；顶部阅读进度线；手机端底部常驻“致电 / 预约”。
- **站内搜索**：右上角搜索按钮，或按 Ctrl+K、“/”打开；索引在构建时自动生成（`assets/data/search.json`）。
- **大字模式**：顶栏“A+ 大字模式”，方便长者阅读，会记住选择。
- **1 分钟照护自测**、**费用估算器**、**预约回电**、**服务网点查询**、中英双语切换。

## 如何修改

根目录下的 `*.html` 是生成出来的文件，**不要直接修改**。请修改 `src/pages/` 里对应的源文件，然后运行：

```bash
pip install fonttools brotli   # 首次运行需要
python3 tools/build.py
```

构建脚本会：拼接统一的页头页脚、展开简写标签、生成 `sitemap.xml` 和 `robots.txt`，并把标题字体裁剪为站内实际用到的汉字（每个字重约 80 KB）。

- **英文内容**：每个元素的英文写在 `data-en` 属性里，中文写在元素内容里。
- **简写标签**：`<kht-icon name="check">`、`<kht-photo …>`、`<kht-crumb …>`，见 `tools/build.py` 中的 `expand()`。
- **样式与交互**：`assets/css/style.css` 与 `assets/js/main.js` 直接修改即可，无需构建。

## 上线前清单

1. **站点设置**：在 `tools/build.py` 顶部的 `SITE` 中填写正式域名、服务热线、邮箱和 ICP 备案号，然后重新构建。
2. **照片**：把照片放进 `assets/img/photos/`，文件名与占位框上标注的一致（如 `hero.jpg`），建议宽 1600px 以内、压缩到 300 KB 以下。照片放好后，占位说明会自动消失。共 13 张，每张的建议画面写在占位框里。
3. **表单接口**：在 `SITE` 中填写 `book_endpoint`、`careers_endpoint`。表单以 JSON 方式 POST 到该地址。可用一个云函数或自有后台接收，再转发到企业微信、邮箱或 CRM（企业微信机器人的格式不同，不能直接作为接收地址）。未配置时，表单会提示用户“请致电预约”，不会丢失客户。
4. **服务网点**：编辑 `assets/data/locations.json`，替换示例网点。
5. **新闻**：删除 `src/pages/news.html` 中带“示例”标记的条目。
6. **隐私政策**：由法务审阅 `src/pages/privacy.html`，补充公司主体名称与生效日期。
7. **品牌**：`assets/img/logo.svg` 为设计稿 Logo；如有正式 Logo，替换该文件和 `logo-light.svg`（深色背景用），并重新生成 `og-image.png`、`apple-touch-icon.png`。

## 部署

任意静态托管均可：国内云服务器或对象存储（需 ICP 备案），或海外的 GitHub Pages、Vercel、Netlify。站内不引用任何境外 CDN 或字体服务，国内访问不受影响。请把 404 页面配置为 `404.html`。
