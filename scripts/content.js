console.log("content is running....");

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
  PARSE_GMAILBUY_SUCCESS: () => {
    console.log("GMAILbuy支付成功页面");

    // 1. 获取 content，如果没有找到则使用 body (确保 content 不为空)
    const contentElement =
      document.querySelector("div.layui-container") || document.body;

    // 2. 安全获取 orderIdElement (防止 querySelector 链式调用报错)
    // 这里的 ?. 作用是：如果第一个 querySelector 没找到，就不会执行第二个，直接返回 undefined
    const orderIdElement = document
      .querySelector("div.layui-container")
      ?.querySelector("div.layui-col-md4");

    // 3. 获取 Order ID，如果有任何报错则赋值为 "none"
    // 逻辑：元素存在? -> 有文本? -> 切割数组? -> 取第2项? -> 去空格 || 否则 "none"
    const orderId =
      orderIdElement?.innerText?.split("订单编号：")?.[1]?.trim() || "none";
    chrome.runtime.sendMessage({
      action: "ACTION_FINAL_UPLOAD",
      data: {
        orderId: orderId,
        content: contentElement.outerHTML,
      },
    });

    return { status: "done" };
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
