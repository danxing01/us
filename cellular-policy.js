const DEFAULTS = {
  groupName: "🚀 节点选择",
  mainlandPolicy: "🇭🇰 香港节点",
  directPolicy: "DIRECT",
  eventDelay: 2.5,
  requestTimeout: 6,
  retries: 3,
  retryDelay: 2
};

function parseArguments(raw) {
  if (!raw) return {};

  return String(raw).split("&").reduce((result, item) => {
    const separator = item.indexOf("=");
    if (separator < 0) return result;

    const key = item.slice(0, separator);
    const value = item.slice(separator + 1);
    try {
      result[key] = decodeURIComponent(value.replace(/\+/g, " "));
    } catch (_) {
      result[key] = value;
    }
    return result;
  }, {});
}

function numberOption(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

const args = parseArguments(typeof $argument === "undefined" ? "" : $argument);
const GROUP_NAME = args.GROUP_NAME || DEFAULTS.groupName;
const MAINLAND_POLICY = args.MAINLAND_POLICY || DEFAULTS.mainlandPolicy;
const DIRECT_POLICY = args.DIRECT_POLICY || DEFAULTS.directPolicy;
const EVENT_DELAY = numberOption(args.EVENT_DELAY, DEFAULTS.eventDelay, 0, 15);
const REQUEST_TIMEOUT = numberOption(args.TIMEOUT, DEFAULTS.requestTimeout, 2, 15);
const MAX_ATTEMPTS = Math.round(numberOption(args.RETRIES, DEFAULTS.retries, 1, 5));
const RETRY_DELAY = numberOption(args.RETRY_DELAY, DEFAULTS.retryDelay, 0, 10);

const STATE_KEY = `network-policy.last-mode.v3.${GROUP_NAME}`;
const IP_ENDPOINT = "https://rmb.pingan.com.cn/itam/mas/linden/ip/request";
const HK_ASNS = ["9231"];
const CN_ASNS = ["9808"];

function finish() {
  $done();
}

function notify(title, body) {
  $notification.post(title, "网络策略自动切换", body);
}

function primaryInterface() {
  const v4 = $network && $network.v4;
  const v6 = $network && $network.v6;
  return (v4 && v4.primaryInterface) || (v6 && v6.primaryInterface) || "";
}

function isWifi() {
  const interfaceName = primaryInterface();
  const wifiSSID = $network && $network.wifi && $network.wifi.ssid;
  return Boolean(wifiSSID) || /^en\d+$/i.test(interfaceName);
}

function isCellular() {
  const interfaceName = primaryInterface();
  const wifiSSID = $network && $network.wifi && $network.wifi.ssid;

  if (wifiSSID) return false;
  if (interfaceName && !/^pdp_ip/i.test(interfaceName)) return false;
  return true;
}

function retryOrFinish(attempt, reason) {
  if (attempt + 1 < MAX_ATTEMPTS) {
    setTimeout(() => probe(attempt + 1), RETRY_DELAY * 1000);
    return;
  }

  notify("网络出口识别失败", `${reason}；已保持当前策略不变`);
  finish();
}

function selectPolicy(policy, callback) {
  $httpAPI("POST", "/v1/policy_groups/select", {
    group_name: GROUP_NAME,
    policy
  }, (result) => {
    if (result && result.error) {
      notify("切换策略失败", `${GROUP_NAME} 无法切换到 ${policy}：${result.error}`);
      finish();
      return;
    }

    callback();
  });
}

function normalizeASN(asn) {
  return String(asn || "").toUpperCase().replace(/^AS/, "");
}

function resolveMode(info, ip, asn) {
  const location = [info.country, info.region, info.city].filter(Boolean).join(" ");
  const normalizedASN = normalizeASN(asn);
  const countryCode = String(info.countryIsoCode || "").toUpperCase();

  if (/香港|澳门|台湾|HONG KONG|MACAU|MACAO|TAIWAN/i.test(location)) {
    return "NON_MAINLAND";
  }
  if (countryCode && countryCode !== "CN") return "NON_MAINLAND";
  if (countryCode === "CN") return "MAINLAND";

  const geoRegion = String($utils.geoip(ip) || "").toUpperCase();
  if (["HK", "MO", "TW"].includes(geoRegion)) return "NON_MAINLAND";
  if (geoRegion && geoRegion !== "CN") return "NON_MAINLAND";
  if (geoRegion === "CN") return "MAINLAND";
  if (HK_ASNS.includes(normalizedASN)) return "NON_MAINLAND";
  if (CN_ASNS.includes(normalizedASN)) return "MAINLAND";
  return "";
}

function applyMode(mode, policy, title, detail) {
  const previousMode = $persistentStore.read(STATE_KEY);
  const isManual = typeof $script !== "undefined" && $script.type === "generic";

  selectPolicy(policy, () => {
    $persistentStore.write(mode, STATE_KEY);
    if (previousMode !== mode || isManual) {
      notify(title, `${detail}；${GROUP_NAME} → ${policy}`);
    }
    finish();
  });
}

function probe(attempt) {
  $httpClient.get({
    url: `${IP_ENDPOINT}?t=${Date.now()}`,
    policy: "DIRECT",
    timeout: REQUEST_TIMEOUT,
    headers: {
      "Cache-Control": "no-cache"
    }
  }, (error, response, body) => {
    if (error) {
      retryOrFinish(attempt, String(error));
      return;
    }

    try {
      const payload = JSON.parse(body);
      const info = payload && payload.data;
      const ip = info && info.ip;
      if (!ip) throw new Error("响应中没有公网 IP");

      const asn = $utils.ipasn(ip);
      const mode = resolveMode(info, ip, asn);
      const normalizedASN = normalizeASN(asn);
      const networkInfo = [info.region, info.city, info.isp].filter(Boolean).join(" ");
      const detail = `出口 ${ip}${normalizedASN ? ` / AS${normalizedASN}` : ""}${networkInfo ? ` / ${networkInfo}` : ""}`;

      if (mode === "MAINLAND") {
        applyMode(mode, MAINLAND_POLICY, "已识别中国大陆网络", detail);
      } else if (mode === "NON_MAINLAND") {
        applyMode(mode, DIRECT_POLICY, "已识别非大陆网络", detail);
      } else {
        notify("网络出口无法归类", `${detail}；已保持当前策略不变`);
        finish();
      }
    } catch (parseError) {
      retryOrFinish(attempt, String(parseError));
    }
  });
}

function evaluateNetwork() {
  if (isWifi()) {
    const wifiSSID = $network && $network.wifi && $network.wifi.ssid;
    const detail = wifiSSID ? `Wi-Fi：${wifiSSID}` : "Wi-Fi 网络";
    applyMode("WIFI", MAINLAND_POLICY, "已识别 Wi-Fi", detail);
  } else if (isCellular()) {
    probe(0);
  } else {
    notify("网络类型无法识别", "已保持当前策略不变");
    finish();
  }
}

if ($environment.system !== "iOS") {
  finish();
} else {
  setTimeout(evaluateNetwork, EVENT_DELAY * 1000);
}
