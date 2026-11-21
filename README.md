# IWATCH Health Dashboard

把 iPhone「健康」App 导出的数据，变成一个**本地离线看板**和一份**可以用 SQL 查询的数据库**。
放入导出文件、运行一条命令即可更新；数据全程不离开你的电脑。

*Turn an Apple Health export into a local, offline dashboard and a queryable SQLite database. One command to update; your data never leaves your machine.*

## 能看到什么

| 分区 | 内容 |
|---|---|
| 总览 | 关键指标卡（与前一个等长时段对比）、趋势、逐月对比表 |
| 活动 | 步数、三个圆环及达标率、总消耗、距离、爬楼、步数日历 |
| 睡眠 | 分期时长、每晚作息时间线、入睡 / 醒来规律、夜间心率 · HRV · 呼吸 · 体温 · 血氧 |
| 心脏 | 静息心率、HRV、VO₂max、每日心率范围、24 小时心率热力图、心电图波形 |
| 训练 | 每周训练量（按类型）、心率区间用时、训练明细、训练日历 |
| 身体 | 体重、体脂率、去脂体重、BMI |
| 洞察 | 最近 7 天相对个人基线的位置、个人纪录、连续天数、指标相关性 |
| 单日 | 任意一天的每分钟心率、睡眠分期、训练时段、每小时步数 |
| 更多 | 血氧、步态、耳机音量、日照、饮水 |
| 数据说明 | 数据来源、时区还原结果、对账结果、全部计算口径 |

所有图表支持时间范围（30 天 / 90 天 / 半年 / 1 年 / 全部 / 自选）和日 / 周 / 月粒度，支持浅色和深色。

## 它解决的两个准确性问题

直接把导出文件里的数字加起来，结果通常是错的：

1. **多设备重复计数**。手机和手表（或手环）会同时记录步数、能量、距离。本项目按时间段和来源优先级去重：同一时刻取优先级最高的设备，低优先级记录中重叠的那部分时间按比例扣除。
2. **时区**。导出文件把所有时间统一写成导出时手机所在的时区。出过国、换过时区的日子，按天统计和作息时间都会错位。本项目根据睡眠和训练记录里的时区信息还原当时所在地；没有时区信息的时段，用 Apple 自己保存的每日汇总反推。

每次更新都会把去重后的活动能量与 Apple 的每日汇总逐日对账，并把偏差打印出来，结果也显示在看板的「数据说明」页。

## 快速开始

**需要**：Python 3.9 或更高版本。不依赖第三方库（Windows 需要 `tzdata` 时区数据包，一键脚本会自动安装）。

1. **导出**：iPhone 健康 App → 右上角头像 → 最下方「导出所有健康数据」，得到一个 zip。
2. **放入 `数据集/` 文件夹**：zip 直接放进去即可，不用解压（解压后的文件夹也认，子文件夹随意）。
3. **运行**：
   - Windows：双击 `更新数据.bat`
   - macOS / Linux：`python3 pipeline/update.py`

约十几秒后看板自动在浏览器打开。以后每次导出，重复第 2、3 步即可；脚本会自动选用**导出时间最新**的那一份。

只想看看板、不更新数据：直接打开 `dashboard/index.html`。

可选参数：

```
python pipeline/update.py --export <某个导出文件夹或zip>   # 指定用哪一份
python pipeline/update.py --data <目录>                    # 换一个存放导出的目录
python pipeline/update.py --no-open                        # 完成后不打开浏览器
python pipeline/update.py --no-db                          # 不生成 health.db
```

## 看板用法

- 指标卡上的 ▲▼ 是和**前一个等长时间段**比（选 90 天，就是和再往前的 90 天比）。
- 鼠标悬停看具体数值；每张图右上角的「表格」可展开底层数字；点图例可隐藏 / 显示某条线。
- **日视图下点击图上任意一天**（或日历里的一格）会跳到「单日」页。
- 静息心率、HRV 等图上的浅蓝色带是**个人基线范围**（此前 28 天的均值 ± 1 个标准差）。数值跑出色带，才是相对你自己平时的真实变化。
- 图上的竖线标出某项指标的主要数据来源发生变化（比如换了设备）的日期，两侧数值不宜直接比较。

## 用 SQL 查询：`health.db`

每次更新会同时生成一个 SQLite 数据库，用 `sqlite3`、[DB Browser for SQLite](https://sqlitebrowser.org/) 或任何支持 SQLite 的工具都能打开。

| 表 / 视图 | 内容 |
|---|---|
| `daily` | 每天一行，看板上的所有指标各占一列 |
| `metrics` | `daily` 各列的中文名和单位（数据字典） |
| `monthly`、`weekly` | `daily` 各列的月均、周均（视图） |
| `records` | 每一条原始采样，带类型、来源、当地时间（视图） |
| `sleep_segments` | 每晚的睡眠分期片段 |
| `workouts` | 每次训练一行，含心率区间用时 |
| `activity_summary` | Apple 自己保存的每日圆环汇总 |
| `timezones` | 每个时间段所在的时区及判断依据 |
| `ecg` | 心电图记录（不含波形） |

两点注意：

- 对步数、能量、距离这类**累计型**指标求和时用 `counted` 列（去重后计入的量），不要用 `value`，否则会重复计数。
- 按天的数字以 `daily` 表为准：它会把跨午夜的采样按时长拆到两天，而 `records` 按采样的开始时间归日。

示例：

```sql
-- 每月平均
SELECT month, steps, sleep_total, rhr, hrv, weight FROM monthly;

-- 每天步数（已去重）
SELECT local_date, ROUND(SUM(counted)) AS steps
FROM records WHERE type = 'StepCount' GROUP BY local_date;

-- 工作日和周末的睡眠时长
SELECT CASE WHEN weekday >= 6 THEN '周末' ELSE '工作日' END AS kind,
       ROUND(AVG(sleep_total), 2) AS hours, COUNT(sleep_total) AS nights
FROM daily GROUP BY kind;

-- 最近 30 天，一天中各小时的平均心率
SELECT substr(local_time, 1, 2) AS hour, ROUND(AVG(value)) AS bpm
FROM records
WHERE type = 'HeartRate'
  AND local_date >= date((SELECT MAX(date) FROM daily), '-30 days')
GROUP BY hour;

-- 有训练的日子，第二天的 HRV 和没训练的日子相比
SELECT CASE WHEN w.date IS NULL THEN '前一天没训练' ELSE '前一天有训练' END AS kind,
       ROUND(AVG(d.hrv), 1) AS hrv, COUNT(d.hrv) AS days
FROM daily d
LEFT JOIN (SELECT DISTINCT date FROM workouts) w ON w.date = date(d.date, '-1 day')
GROUP BY kind;
```

## 设置

把 `config.example.json` 复制为 `config.json` 再修改（`config.json` 不会被 git 跟踪）：

```json
{
  "data_dir": "数据集",
  "source_priority": [],
  "timezone_overrides": []
}
```

- `source_priority`：多设备同时记录时谁优先。默认 Apple Watch → iPhone → 其他 App。想让某个来源排最前，写它名字里的关键字，例如 `["手环", "Watch"]`。
- `timezone_overrides`：自动还原的时区不对时手动指定，例如
  `[{"from": "2024-05-01", "to": "2024-05-07", "tz": "Europe/Paris"}]`。

## 计算口径（简版）

- **睡眠**：一个「睡眠日」是当地时间前一天 18:00 到当天 18:00，记在醒来那天，包含小睡。同一晚有多个来源时优先采用带分期的来源；只有「卧床」记录的夜晚单独标灰，不计入睡眠时长。
- **心率**：全天平均按 5 分钟分箱后再平均，避免训练时的密集采样把均值拉高。
- **圆环**：活动能量、锻炼分钟、站立小时优先采用 Apple 的每日汇总；没有汇总的日子用去重后的记录求和。
- **趋势线**：日视图的粗线是 7 日滑动平均；周 / 月视图取该周 / 月内有数据日子的平均值，周从周一开始。
- **导出当天**：全天累计类指标不完整，会从该日剔除。

完整说明在看板的「数据说明」页。

## 隐私

- 所有处理都在本机完成：脚本只读本地文件，看板是纯本地网页，不联网、不上传。
- `.gitignore` 已经排除了 `数据集/`、`dashboard/data.js`、`dashboard/intraday.js`、`health.db` 和 `config.json`。如果你 fork 了这个项目，**不要把这些文件提交上去**，它们包含你的全部健康记录。

## 局限

- 只做数据整理和展示，参考范围是通用健康指引，**不构成医疗诊断或建议**。
- 不同设备的算法不同（尤其是静息心率和睡眠分期），换设备前后的数值不宜直接比较。
- 心电图的「估算心率」由本项目根据 R 波间距计算，不是 Apple 给出的数值。
- 运动轨迹（GPX）目前没有可视化。
- 目前只在中文系统的导出（`导出.xml`）上实际验证过。英文系统的 `export.xml` 同样会被识别，但没有充分测试。

## 项目结构

| 路径 | 作用 |
|---|---|
| `数据集/` | 放 iPhone 导出的 zip 或解压后的文件夹 |
| `更新数据.bat` | Windows 一键更新 |
| `pipeline/update.py` | 入口：解析 → 去重 → 时区 → 汇总 → 输出 |
| `pipeline/hk/` | 各步骤的实现（解析、时区、去重与按天汇总、睡眠、训练与心电、SQLite） |
| `dashboard/` | 看板页面（原生 JS + ECharts，无需构建） |
| `health.db` | 生成的 SQLite 数据库（不入库） |

## 许可证

本项目以 [MIT 许可证](LICENSE) 发布。随仓库附带的 ECharts 仍适用它自己的 Apache-2.0 许可证（见 `dashboard/vendor/echarts.LICENSE.txt`）。

## 致谢

- 图表使用 [Apache ECharts](https://echarts.apache.org/)（Apache-2.0，已随仓库放在 `dashboard/vendor/`）。
- 功能设计参考了这些项目的思路（未使用其代码）：
  [vitalog](https://github.com/geocoug/vitalog)（个人纪录、相关性、月度表着色）、
  [HealthPulse](https://github.com/eprouveze/HealthPulse)（基于 HRV 和静息心率的恢复状态、日历热力图、连续天数）、
  [apple-health-grafana](https://github.com/k0rventen/apple-health-grafana)（保留原始采样、可下钻到单日）。
