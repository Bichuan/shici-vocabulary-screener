# 拾词使用量统计

网页和主屏幕版在首次成功保存答案后生成一个随机编号。记录保存在独立的 IndexedDB 数据库，断网时等待下次联网或打开时补记。请求体只有这一个随机编号。数据库以编号去重，统计的是曾开始筛词的浏览器存储数量。网页与主屏幕应用共享网站存储时计一次，各自保存网站数据时会各计一次。

正式 Pages 构建通过仓库变量 `VITE_USAGE_ENDPOINT` 启用统计。变量为空时，生产版不记录或发送使用信息。桌面程序使用本地协议，统计仅在 HTTPS 页面启用。

## 连接 Cloudflare

1. 在此目录用 `npx wrangler login` 登录有权管理统计的 Cloudflare 账户。
2. 用 `npx wrangler d1 create shici-usage` 创建数据库。将 `wrangler.example.jsonc` 复制为 `wrangler.local.jsonc`，把返回的数据库 ID 填到 `database_id`。
3. 用 `npx wrangler d1 execute shici-usage --remote --config wrangler.local.jsonc --file schema.sql` 建表，再用 `npx wrangler deploy --config wrangler.local.jsonc` 发布。
4. 在 GitHub 仓库 Actions 的 Variables 中设置 `VITE_USAGE_ENDPOINT`，值为 Worker 的 HTTPS 地址与 `/first-use` 路径，重新运行 Pages 部署。线上用独立浏览器配置首次筛一题，检查请求成功和数据库总数。

在 Cloudflare 的 D1 控制台运行下方查询即可查看累计使用量。

```sql
SELECT COUNT(*) AS total FROM first_use;
```
