console.log("service-worker.js is running....");

// const API_URL = "http://192.168.30.8:8080/v1/api/syncrawlog";
const API_URL = "http://localhost:8080/v1/api/syncrawlog";

// 存储临时获取的邮箱和密码
const TAB_DATA_STORE = {};

const SITE_CONFIG = {
  "tuitehao.cc": {
    sourceCode: "TUITEHAO",
    rules: [
      {
        pattern: /tuitehao\.cc\/product\/query\?zlkbmethod=auto&orderid=/,
        taskName: "PARSE_TUITEHAO_SUCCESS",
      },
      {
        pattern: /tuitehao\.cc\/product\/.*\.html/,
        taskName: "TASK_TUITEHAO_INPUT",
      },
    ],
  },
  "gmailbuy.com": {
    sourceCode: "GMAILBUY",
    rules: [
      {
        pattern: /gmailbuy\.com\/home\/order\/query\.html\?ot=/,
        taskName: "PARSE_GMAILBUY_SUCCESS",
      },
    ],
  },
};

/**
 * 获取url对应的hostname
 * @param {*} url 当前页的url
 * @returns
 */
const getDomain = (url) => {
  if (!url) return null;
  try {
    const { hostname } = new URL(url);
    return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
  } catch (e) {
    return null;
  }
};

// 监听标签网址变化
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;

  // 获取当前网页域名
  const domain = getDomain(tab.url);

  // 判断域名是在配置文件中
  const siteConfig = SITE_CONFIG[domain];
  if (!siteConfig) return;

  // 是我们的目标网站，判断是否目标url
  const matchedRule = siteConfig.rules.find((rule) =>
    rule.pattern.test(tab.url)
  );

  // 是目标url
  if (matchedRule) {
    console.log(
      `[初始化页面]：${siteConfig.sourceCode} | ${matchedRule.taskName}`
    );

    // 给content.js 发送消息
    chrome.tabs
      .sendMessage(tabId, {
        action: "EXECUTE_TASK",
        taskName: matchedRule.taskName,
      })
      .then((response) => {
        console.log("Content Script初始化状态：", response);
      })
      .catch((err) => console.debug("连接content script失败", err));
  }
});

//  监听content发回的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab.id;

  if (message.action === "ACTION_STAGE_DATA") {
    console.log(`[SW] tab ${tabId} 暂存数据`);

    TAB_DATA_STORE[tabId] = {
      ...(TAB_DATA_STORE[tabId] || {}),
      ...message.data,
    };
    console.log("TAB_DATA_STORE => ", TAB_DATA_STORE);

    sendResponse({ success: true });
  } else if (message.action === "ACTION_FINAL_UPLOAD") {
    console.log(`[SW] tab ${tabId} 最终上传`);

    const stageData = TAB_DATA_STORE[tabId] || {};

    const finalPayload = {
      ...stageData,
      ...message.data,
    };

    const domain = getDomain(sender.tab.url);
    const config = SITE_CONFIG[domain];

    if (config) {
      uploadToBackend(config.sourceCode, finalPayload);
    }

    delete TAB_DATA_STORE[tabId];

    sendResponse({ success: true });
  }
});

/**
 *
 * 像后端发送同步请求
 * @param {*} sourceCode 网站标识符
 * @param {*} contentData content获取的dom
 */
async function uploadToBackend(sourceCode, contentData) {
  const { orderId, ...restData } = contentData;

  const payload = {
    sourceCode: sourceCode,
    externalOrderIdHint: orderId || "",
    rawContent: JSON.stringify(restData),
  };

  console.log("准备发送后端的数据：", payload);

  try {
    await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    console.log("同步成功");
  } catch (error) {
    console.error("发送同步请求失败", error);
  }
}
