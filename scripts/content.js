console.log("content is running....");

// 等待元素出现的工具函数（支持超时）
function waitForElementWithText(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const check = () => {
      const el = document.querySelector(selector);
      if (el && el.innerText.trim() !== "") {
        resolve(el);
        return true;
      }
      return false;
    };
    if (check()) return;

    const observer = new MutationObserver(() => {
      if (check()) observer.disconnect();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    setTimeout(() => {
      observer.disconnect();
      reject(
        new Error(
          `Element "${selector}" with text not found within ${timeout}ms`,
        ),
      );
    }, timeout);
  });
}

const PAGE_PARSERS = {
  PARSE_TUITEHAO_SUCCESS: () => {
    console.log("TUITEHAO支付成功页面");

    const handleButtonClick = (kmBtn) => {
      const checkContentTimer = setInterval(() => {
        const pElement = document.querySelector("p#km");

        if (pElement && pElement.innerText.trim().length > 0) {
          clearInterval(checkContentTimer);

          const htmlContent = pElement.outerHTML;
          const orderId = kmBtn.getAttribute("data-orderid");

          console.log("抓取成功", htmlContent);

          chrome.runtime.sendMessage({
            action: "ACTION_FINAL_UPLOAD",
            data: {
              orderId: orderId,
              content: htmlContent,
            },
          });
        }
      }, 200);
    };

    const tryBind = () => {
      const kmBtn = document.querySelector("button[data-orderid]");

      if (kmBtn && !kmBtn.dataset.hasBound) {
        kmBtn.dataset.hasBound = "true";
        kmBtn.addEventListener("click", () => handleButtonClick(kmBtn));
        return true;
      }
      return false;
    };

    if (!tryBind()) {
      const observer = new MutationObserver(() => tryBind());
      observer.observe(document.body, { childList: true, subtree: true });
    }
    return { status: "observing" };
  },
  TASK_TUITEHAO_INPUT: () => {
    console.log("获取邮箱页面");

    const emailInput = document.querySelector("#email");
    const pwdInput = document.querySelector("#chapwd");
    const buyBtn = document.querySelector("#buy");

    if (!emailInput || !buyBtn) {
      return { status: "error", msg: "TUITEHAO无email表单" };
    }

    const sendDataToSW = () => {
      if (emailInput.value && pwdInput.value) {
        chrome.runtime.sendMessage({
          action: "ACTION_STAGE_DATA",
          data: {
            email: emailInput.value,
            chapwd: pwdInput.value,
          },
        });
      }
    };

    emailInput.addEventListener("change", sendDataToSW);
    pwdInput.addEventListener("change", sendDataToSW);

    if (buyBtn) {
      buyBtn.addEventListener("click", sendDataToSW);
    }
    return { status: "listening", msg: "输入页就绪" };
  },
  PARSE_GMAILBUY_SUCCESS: async () => {
    console.log("GMAILbuy支付成功页面，等待订单号出现...");
    try {
      // 直接等待订单号所在的 span 出现且有内容
      const orderIdSpan = await waitForElementWithText(
        "#order-out-tradeno",
        15000,
      );
      const orderId = orderIdSpan.innerText.trim(); // 直接拿到数字
      // 获取内容容器（外层 div，用于整个页面的 DOM 快照）
      const contentElement =
        document.querySelector("div.layui-container") || document.body;
      console.log("获取到的订单号：", orderId);
      // 注意：不要打印 contentElement.outerHTML 到控制台，可能非常长
      chrome.runtime.sendMessage({
        action: "ACTION_FINAL_UPLOAD",
        data: {
          orderId: orderId,
          content: contentElement.outerHTML,
        },
      });
      return { status: "done" };
    } catch (error) {
      console.error("等待订单号超时或失败:", error);
      return { status: "error", message: error.message };
    }
  },

  NEW_TASK_TUITEHAO_INPUT: () => {
    console.log("获取新邮箱页面");

    const emailInput = document.querySelector("input[name='email']");
    const buyBtn = document.querySelector("button.checkout-btn.btn-buy-now");

    if (!emailInput) {
      return { status: "error", msg: "TUITEHAO无email输入框" };
    }

    const sendDataToSW = () => {
      if (emailInput.value) {
        chrome.runtime.sendMessage({
          action: "ACTION_STAGE_DATA",
          data: {
            email: emailInput.value,
            chapwd: "",
          },
        });
      }
    };

    emailInput.addEventListener("change", sendDataToSW);

    if (buyBtn) {
      buyBtn.addEventListener("click", sendDataToSW);
    }
    return { status: "listening", msg: "输入页就绪" };
  },
  NEW_PARSE_TUITEHAO_SUCCESS: () => {
    console.log("TUITEHAO 订单详情监控启动 (隐身无感模式)");

    // ==========================================
    // 0. 注入隐身 CSS（把弹窗赶到屏幕外并透明化）
    // ==========================================
    if (!document.getElementById("__plugin_hidden_style")) {
      const style = document.createElement("style");
      style.id = "__plugin_hidden_style";
      // 只有当 body 拥有 __plugin_hide_modal 类时，才隐藏 layui 弹窗和黑色遮罩层
      style.innerHTML = `
            body.__plugin_hide_modal .layui-layer,
            body.__plugin_hide_modal .layui-layer-shade {
                opacity: 0 !important;
                visibility: hidden !important;
                left: -10000px !important;
                top: -10000px !important;
                transition: none !important;
                animation: none !important;
            }
        `;
      document.head.appendChild(style);
    }

    // 1. 提取订单卡片信息
    const getOrderCardInfo = () => {
      const orderCard = document.querySelector(".order-card");
      if (!orderCard) return null;

      const orderIdText =
        orderCard.querySelector(".order-header h3")?.innerText || "";
      const orderId = orderIdText.replace("订单号:", "").trim();

      const infoSpans = orderCard.querySelectorAll(".order-info span");
      const details = Array.from(infoSpans).map((span) =>
        span.innerText.replace(/\s+/g, " ").trim(),
      );

      return { orderId, details, cardHtml: orderCard.outerHTML };
    };

    // 2. 核心：处理按钮点击
    const handleButtonClick = (btn) => {
      const isCopyBtn = btn.classList.contains("btn-treasure-copy");
      const tdElement = btn.closest("td");
      const tradeNo = tdElement ? tdElement.getAttribute("data-tradeno") : "";

      const orderInfo = getOrderCardInfo() || { orderId: tradeNo, details: [] };

      // 如果用户点的是“复制”，开启隐身模式，并偷偷点击“查看”
      if (isCopyBtn && tdElement) {
        const showBtn = tdElement.querySelector(".btn-treasure-show");
        if (showBtn) {
          // 【精髓】：在点击查看前，给 body 加上隐身 class，让弹窗瞬间隐形
          document.body.classList.add("__plugin_hide_modal");
          showBtn.click();
        }
      }

      let attempts = 0;

      // 3. 轮询等待网站解密完毕并渲染出 textarea
      const checkContentTimer = setInterval(() => {
        attempts++;

        // 锁定卡密文本框
        const textAreaElement = document.querySelector(
          "textarea[name='treasure']",
        );

        if (textAreaElement && textAreaElement.value.trim().length > 0) {
          clearInterval(checkContentTimer);

          const htmlContent = textAreaElement.outerHTML;
          const textContent = textAreaElement.value.trim();

          console.log("截获卡密数据成功!", textContent);

          // 4. 发送给 Service Worker
          chrome.runtime.sendMessage({
            action: "ACTION_FINAL_UPLOAD",
            data: {
              orderId: orderInfo.orderId,
              orderCardDetails: orderInfo.details,
              orderCardHtml: orderInfo.cardHtml,
              kmHtml: htmlContent,
              kmText: textContent,
            },
          });

          // 5. 如果是隐藏模式，销毁弹窗并解除隐身
          if (isCopyBtn) {
            const closeBtn = document.querySelector(".layui-layer-close");
            if (closeBtn) closeBtn.click(); // 点击自带的关闭按钮

            // 稍微延迟解除隐身，防止弹窗在关闭动画期间闪烁
            setTimeout(() => {
              document.body.classList.remove("__plugin_hide_modal");
            }, 300);
          }
        } else if (attempts > 50) {
          // 超时 (10秒)
          clearInterval(checkContentTimer);
          console.log("抓取超时");

          // 发生异常也要解除隐身，防止影响用户正常浏览
          if (isCopyBtn) {
            document.body.classList.remove("__plugin_hide_modal");
          }
        }
      }, 200);
    };

    // 尝试绑定点击事件
    const tryBind = () => {
      const actionBtns = document.querySelectorAll(
        ".btn-treasure-show, .btn-treasure-copy",
      );
      let boundCount = 0;

      actionBtns.forEach((btn) => {
        if (!btn.dataset.hasBound) {
          btn.dataset.hasBound = "true";
          btn.addEventListener("click", () => handleButtonClick(btn));
          boundCount++;
        }
      });

      return boundCount > 0;
    };

    // 持续监控 DOM 变化
    if (!tryBind()) {
      const observer = new MutationObserver(() => tryBind());
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return { status: "observing" };
  },
};

// 监听SW发送的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "EXECUTE_TASK") {
    const taskName = request.taskName;
    console.log("接收到任务指令", taskName);

    const parserFunc = PAGE_PARSERS[taskName];

    if (parserFunc) {
      try {
        const resultData = parserFunc();

        console.log("解析完成", resultData);

        sendResponse({
          success: true,
          data: resultData,
        });
      } catch (error) {
        console.error("DOM 解析出错：", error);

        sendResponse({
          success: false,
          error: error.message,
        });
      }
    } else {
      console.warn(`未找到名为${taskName}解析策略`);
      sendResponse({ success: false, message: "TaskName not found" });
    }
  }

  return true;
});
