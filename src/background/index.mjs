import { v4 as uuidv4 } from 'uuid'
import Browser from 'webextension-polyfill'
import { generateAnswersWithChatgptWebApi, sendMessageFeedback } from './chatgpt-web.mjs'
import {
  chatgptApiModelKeys,
  chatgptWebModelKeys,
  getUserConfig,
  gptApiModelKeys,
  isUsingApiKey,
} from '../config.js'
import {
  generateAnswersWithChatgptApi,
  generateAnswersWithGptCompletionApi,
} from './openai-api.mjs'
import ExpiryMap from 'expiry-map'
import { isSafari } from '../utils.mjs'

const KEY_ACCESS_TOKEN = 'accessToken'
const cache = new ExpiryMap(10 * 1000)

/**
 * @returns {Promise<string>}
 */
async function getAccessToken() {
  if (cache.get(KEY_ACCESS_TOKEN)) {
    return cache.get(KEY_ACCESS_TOKEN)
  }
  if (isSafari()) {
    const userConfig = await getUserConfig()
    if (userConfig.accessToken) {
      cache.set(KEY_ACCESS_TOKEN, userConfig.accessToken)
    } else {
      throw new Error('UNAUTHORIZED')
    }
  } else {
    const resp = await fetch('https://chat.openai.com/api/auth/session')
    if (resp.status === 403) {
      throw new Error('CLOUDFLARE')
    }
    const data = await resp.json().catch(() => ({}))
    if (!data.accessToken) {
      throw new Error('UNAUTHORIZED')
    }
    cache.set(KEY_ACCESS_TOKEN, data.accessToken)
  }
  return cache.get(KEY_ACCESS_TOKEN)
}

Browser.runtime.onConnect.addListener((port) => {
  console.debug('connected')
  port.onMessage.addListener(async (msg) => {
    console.debug('received msg', msg)
    const config = await getUserConfig()
    const session = msg.session
    if (session.useApiKey == null) {
      session.useApiKey = isUsingApiKey(config)
    }

    try {
      if (chatgptWebModelKeys.includes(config.modelName)) {
        const accessToken = await getAccessToken()
        session.messageId = uuidv4()
        if (session.parentMessageId == null) {
          session.parentMessageId = uuidv4()
        }
        await generateAnswersWithChatgptWebApi(port, session.question, session, accessToken)
      } else if (gptApiModelKeys.includes(config.modelName)) {
        await generateAnswersWithGptCompletionApi(
          port,
          session.question,
          session,
          config.apiKey,
          config.modelName,
        )
      } else if (chatgptApiModelKeys.includes(config.modelName)) {
        await generateAnswersWithChatgptApi(
          port,
          session.question,
          session,
          config.apiKey,
          config.modelName,
        )
      }
    } catch (err) {
      console.error(err)
      port.postMessage({ error: err.message })
      cache.delete(KEY_ACCESS_TOKEN)
    }
  })
})

Browser.runtime.onMessage.addListener(async (message) => {
  if (message.type === 'FEEDBACK') {
    const token = await getAccessToken()
    await sendMessageFeedback(token, message.data)
  }
})

chrome.contextMenus.create({
  id: "p1",
  title: "ChatGPT",
  contexts: ["selection"]
});

["直接输入", "prompt 生成", "内容提炼", "文本分类", "批判性分析", "文字润色"].forEach(m => {
  chrome.contextMenus.create({
    id: m,
    parentId: 'p1',
    title: m,
    contexts: ["selection"]
  });
});
chrome.contextMenus.onClicked.addListener(function (info, tab) {
  chrome.tabs.query({
    "active": true,
    "currentWindow": true
  }, function (tabs) {
    chrome.tabs.sendMessage(tabs[0].id, {
      "info": info,
      "tab": tab
    });
  });
});