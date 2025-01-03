import { CozeV3Api } from "./sdk/cozev3.js";
import { addAichatRecord } from "../db/aichatDb.js";
import { getPromotInfo } from "../proxy/aibotk.js";
import { ContentCensor } from "../lib/contentCensor.js";
import { getPuppetEol, isWindowsPlatform } from '../const/puppet-type.js'
import dayjs from "dayjs";
import { extractImageLinks } from '../lib/index.js'
import {getText2Speech} from "../proxy/multimodal.js";


class CozeV3Ai {
  constructor(config = {
    botId: '',
    isAiAgent: false, // 是否为 ai agent 模式
    showDownloadUrl: false, // 显示文件下载链接
    token: '', // api 秘钥
    proxyPass: '', // 请求地址
    showQuestion: true, // 显示原文
    timeoutMs: 60, // 超时时间 s
    promotId: '',
    systemMessage: '', // 预设promotion
  }) {
    this.cozeV3Chat = null;
    this.config = { showDownloadUrl: false, isAiAgent: false, ...config };
    this.contentCensor = null
    this.chatOption = {};
    this.eol = '\n'
    this.iswindows = false;
  }


  async init() {
    this.eol = await getPuppetEol();
    this.iswindows = await isWindowsPlatform()
    if(this.config.promotId) {
      const promotInfo = await getPromotInfo(this.config.promotId)
      if(promotInfo) {
        this.config.systemMessage = promotInfo.promot
      }
    }
    if(this.config.filter) {
      this.contentCensor = new ContentCensor(this.config.filterConfig)
    }
    const baseOptions = {
      baseUrl: this.config.proxyPass,
      apiKey: this.config.token,
      botId: this.config.botId,
      stream: this.config.stream,
      debug: !!this.config.debug,
      systemMessage: this.config.systemMessage || '',
    }

    console.log(`api请求地址:${this.config.proxyPass}`);
    this.cozeV3Chat = new CozeV3Api({
      ...baseOptions,
    });
  }
  /**
   * 重置apikey
   * @return {Promise<void>}
   */
  reset () {
    this.cozeV3Chat = null
  }


  async getReply({ content, inputs }, id, adminId = '', systemMessage = '') {
    try {
      if(!this.cozeV3Chat) {
        console.log('启用Coze v3对话平台');
        await this.init()
      }
      if(this.config.filter) {
        const censor = await this.contentCensor.checkText(content)
        if(!censor) {
          console.log(`问题:${content},包含违规词，已拦截`);
          return [{ type: 1, content: '这个话题不适合讨论，换个话题吧。' }]
        }
      }
      if(systemMessage || content === 'reset' || content === '重置') {
        console.log('重新更新上下文对话');
        this.chatOption[id] = {}
        if(content === 'reset' || content === '重置') {
          return [{type: 1, content: '上下文已重置'}]
        }
      }
      const { conversationId, text } = systemMessage ? await this.cozeV3Chat.sendMessage(content, { ...this.chatOption[id], variables: inputs, systemMessage, timeoutMs: this.config.timeoutMs * 1000 || 80 * 1000, user: id }) : await this.cozeV3Chat.sendMessage(content, { ...this.chatOption[id], variables: inputs, timeoutMs: this.config.timeoutMs * 1000 || 80 * 1000, user: id });
      if(this.config.filter) {
        const censor = await this.contentCensor.checkText(text)
        if(!censor) {
          console.log(`回复: ${text},包含违规词，已拦截`);
          return [{ type: 1, content: '这个话题不适合讨论，换个话题吧。' }]
        }
      }
      if(this.config.record) {
        void addAichatRecord({ contactId: id, adminId, input: content, output: text, time: dayjs().format('YYYY-MM-DD HH:mm:ss') })
      }
      // 保存对话id 对于同一个用户的对话不更新conversationId
      if(!this.chatOption[id]?.conversationId) {
        this.chatOption[id] = {
          conversationId
        };
      }
      let replys = []
      if(this.config?.openTTS) {
        replys = await getText2Speech(text, this.config.ttsConfig)
        if(replys.length) {
          return replys
        }
      }
      let message;
      if(this.config.showQuestion) {
        message = `${content}${this.eol}-----------${this.eol}` +  (this.iswindows ? text.replaceAll('\n', this.eol) : text);
      } else {
        message =  this.iswindows ? text.replaceAll('\n', this.eol) : text;
      }
      const imgs = extractImageLinks(message)

      while (message.length > 1500) {
        replys.push(message.slice(0, 1500));
        message = message.slice(1500);
      }
      replys.push(message);
      replys = replys.map(item=> {
        return {
          type: 1,
          content: item.trim()
        }
      })

      if(imgs.length) {
        console.log('提取到内容中的图片', imgs)
        replys = replys.concat(imgs)
      }

      return replys
    } catch (e) {
      console.log('Coze V3 请求报错：'+ e);
      return []
    }
  }
}

export default CozeV3Ai;
