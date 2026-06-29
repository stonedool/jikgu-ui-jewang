import type { PageContext } from "./types";

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

function sendCollectMessage(tabId: number): Promise<PageContext> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: "COLLECT_PAGE_CONTEXT" }, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }

      if (!response?.ok || !response.pageContext) {
        reject(new Error("페이지 컨텍스트를 수집하지 못했습니다."));
        return;
      }

      resolve(response.pageContext as PageContext);
    });
  });
}

export async function collectPageContext(): Promise<PageContext> {
  const tab = await getActiveTab();
  if (!tab?.id) {
    throw new Error("활성 탭을 찾지 못했습니다.");
  }

  try {
    return await sendCollectMessage(tab.id);
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["assets/contentScript.js"]
    });

    return sendCollectMessage(tab.id);
  }
}
