# 在线预约接收服务

网站的“预约照护”“预约回电”“护工报名”三张表单提交后，由这个小服务接收，并立即推送到企业微信群，客服在群里就能看到每一条预约。

- 没有任何第三方依赖，一个文件 `app.js`。
- 部署在腾讯云云函数（SCF）上，国内访问稳定，按调用次数计费，预约量不大时费用很低。
- 自带校验（必填项、手机号格式）、防机器人（隐藏字段）、限流（同一 IP 10 分钟内最多 5 次）。

## 第一步：在企业微信群里添加机器人

1. 打开企业微信，进入接收预约的群（例如“康护通客服群”）。
2. 群设置 → 群机器人 → 添加机器人 → 新创建一个机器人，起名如“预约通知”。
3. 复制机器人的 **Webhook 地址**，形如 `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxx`。

> 这个地址相当于密码，不要发到公开的地方，也不要写进网站代码里。

## 第二步：部署到腾讯云云函数

1. 登录 [腾讯云控制台](https://console.cloud.tencent.com/scf)，进入“云函数 SCF”，选择离客户近的地域（如广州、上海）。
2. 新建函数：
   - 创建方式：**从头开始**
   - 函数类型：**Web 函数**
   - 运行环境：**Nodejs 18**
   - 函数代码：选择“本地上传文件夹”，上传本目录（`app.js` 和 `scf_bootstrap`）
3. 在“环境配置 → 环境变量”中添加：
   - `WECOM_WEBHOOK`：第一步复制的机器人地址
   - `ALLOWED_ORIGINS`：网站正式域名，如 `https://www.你的域名.com`（多个用英文逗号分隔；先不填则任何网站都能提交，仅建议测试时这样做）
4. 在“触发管理”中创建 **API 网关触发器**（或函数 URL），得到一个访问地址，例如 `https://service-xxxx.gz.apigw.tencentcs.com/release/`。
5. 在浏览器打开 `访问地址/health`，看到 `{"ok":true}` 即部署成功。

## 第三步：把地址填进网站

1. 打开 `tools/build.py`，在顶部的 `SITE` 中把同一个访问地址填入两项：

   ```python
   "book_endpoint": "https://service-xxxx.gz.apigw.tencentcs.com/release/",
   "careers_endpoint": "https://service-xxxx.gz.apigw.tencentcs.com/release/",
   ```

2. 运行 `python3 tools/build.py`，重新部署网站。
3. 在网站上提交一条测试预约，企业微信群里应在几秒内收到通知。

## 隐私提示

预约内容包含患者姓名、所在病房和健康需求，属于敏感个人信息：

- 只把机器人加在**仅客服人员**所在的群里；
- 定期清理群聊记录，或按公司制度转存到正式系统；
- 网站隐私政策中已说明信息用途，如流程变化请同步更新。

## 本地测试

```bash
WECOM_WEBHOOK="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxx" node app.js
curl -X POST localhost:9000 -H 'Content-Type: application/json' \
  -d '{"form":"callback","name":"测试","phone":"13800000000"}'
```
