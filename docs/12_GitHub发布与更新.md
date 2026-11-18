# GitHub发布与更新

## 仓库与网站

- 源码仓库：[2250801112/blood-mist-bansy](https://github.com/2250801112/blood-mist-bansy)
- 在线游戏：[血雾班西](https://2250801112.github.io/blood-mist-bansy/)
- 部署进度：[Actions](https://github.com/2250801112/blood-mist-bansy/actions)

项目沿用现有公开仓库和提交历史，当前开发目录直接关联`origin`与`main`，无需再把代码复制到临时发布目录。GitHub Pages发布源为`main`分支根目录；推送成功后，GitHub在服务器上自动部署。

这里的持续更新以一次完成并验证的修改为单位。提交记录保存每次版本，朋友们始终使用同一个游玩链接。部署完成后，本机可以关机；尚未推送的本地修改只有本机可见。

## 每次更新

先查看本次改动：

```powershell
git status --short
git diff
```

在项目目录执行README中的数据校验、规则测试、启动测试与真实浏览器验收，并运行`git diff --check`。只暂存本次确认要发布的文件。例如场景、页面及测试修改可以逐项暂存：

```powershell
git add game data tests tools docs README.md
git diff --cached --stat
git diff --cached --check
git commit -m "描述本次游戏更新"
git push origin main
```

有新插画时一并暂存实际需要的`assets`文件；有其他新增根文件时明确加入。不要将凭据、临时日志或浏览器存档放入源码。原开发包的`MANIFEST.json`只说明原包的校验信息，保留在本地，不作为当前发布清单。

推送成功后检查Actions中的`pages build and deployment`任务，确认其提交与本次提交一致。也可以使用已登录的GitHub CLI：

```powershell
gh run list --repo 2250801112/blood-mist-bansy --limit 3
```

部署任务成功后，打开公开游玩链接，刷新页面，检查新界面、数据和插画。游戏存档仍保存在各个浏览器中；网页更新不会给不同设备同步存档。

若推送提示远端已有更新，先取回并审阅差异后合并，再验证和推送，保持正常提交历史。不要用强制推送覆盖其他修改。若自动部署失败，查看该次任务的日志，修复后提交新版本。

## 发布方式说明

当前是纯静态Web游戏，现有分支发布已支持推送后自动部署，因此继续复用它。本轮不新增云服务器、付费服务、文件监控常驻程序或运行依赖。

GitHub CLI登录由本机凭据存储管理。仓库文件和部署配置不写入个人Token；日常可让Codex在修改验收完成后提交推送，再等待部署并验证公开页面。
