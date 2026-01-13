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

    const orderIdElement = document
      .querySelector("div.layui-container")
      .querySelector("div.layui-col-md4");

    const content = document.querySelector("div.layui-container");
    const orderId = orderIdElement.innerText.split("订单编号：")[1].trim();
    chrome.runtime.sendMessage({
      action: "ACTION_FINAL_UPLOAD",
      data: {
        orderId: orderId,
        content: content,
      },
    });

    return { status: "done" };
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
