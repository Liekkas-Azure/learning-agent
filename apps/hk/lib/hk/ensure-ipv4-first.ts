import { setDefaultResultOrder } from "node:dns";

/** 部分行情域名在 IPv6 下会立即断连，强制优先 IPv4 以提高服务端 fetch 成功率 */
setDefaultResultOrder("ipv4first");
