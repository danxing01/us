# Surge 网络策略自动切换模块

该模块根据 iPhone 当前网络环境自动切换一个 Surge 手动策略组。

## 默认逻辑

| 当前网络 | 默认策略 |
| --- | --- |
| Wi-Fi | `🇭🇰 香港节点` |
| 中国大陆蜂窝出口 | `🇭🇰 香港节点` |
| 香港、澳门、台湾及其他非大陆蜂窝出口 | `DIRECT` |
| 无法识别 | 保持当前策略不变 |

判断依据是直连公网出口，而不是 SIM 名称或卡槽。境外 SIM 如果漫游后从中国
大陆出口，仍会按大陆网络处理。

## 安装

在 Surge iOS 中通过以下原始链接安装并启用模块：

```text
https://raw.githubusercontent.com/danxing01/us/main/cellular-policy.sgmodule
```

模块提供“网络策略手动检测”脚本，可用于切卡后的手动验证。

## 参数

- `GROUP_NAME`：需要自动切换的手动策略组。
- `MAINLAND_POLICY`：Wi-Fi 和中国大陆出口使用的策略。
- `DIRECT_POLICY`：非大陆出口使用的策略。
- `EVENT_DELAY`：网络变化后的等待时间。
- `TIMEOUT`：单次 IP 信息查询超时。
- `RETRIES`：最多尝试次数。
- `RETRY_DELAY`：失败后的重试间隔。

默认配置适配：

```text
🚀 节点选择
├── 🇭🇰 香港节点
└── DIRECT
```

## 识别与容错

蜂窝探测显式使用 `DIRECT`，避免当前代理改变查询到的出口。脚本优先读取
国家和地区字段，并使用 Surge GeoIP、`AS9231`（中国移动香港）与
`AS9808`（中国移动大陆）兜底。请求失败或结果不明时不会切换策略。

该模块参考：

- <https://github.com/xream/scripts/tree/main/surge/modules/network-info>
- <https://rmb.pingan.com.cn/itam/mas/linden/ip/request>
