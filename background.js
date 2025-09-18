// 处理来自popup和content script的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'processAndSend') {
    // 如果tabId为null，自动获取当前标签页
    if (!request.tabId) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs.length > 0) {
          handleProcessAndSend(tabs[0].id, request.config)
            .then(result => sendResponse(result))
            .catch(error => sendResponse({ success: false, error: error.message }));
        } else {
          sendResponse({ success: false, error: '无法获取当前标签页' });
        }
      });
    } else {
      handleProcessAndSend(request.tabId, request.config)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
    }
    return true; // 保持消息通道开放
  }
});

// 主要处理函数
async function handleProcessAndSend(tabId, config) {
  try {
    // 调试信息
    console.log('配置信息:', config);
    console.log('系统提示词配置:', config.systemPrompt);
    
    // 1. 从页面提取内容
    const pageData = await extractPageContent(tabId);
    
    // 2. 过滤和清理内容
    const cleanedPageData = filterAndCleanContent(pageData);
    
    // 3. 使用AI总结内容
    const summary = await summarizeWithAI(cleanedPageData, config.openaiKey, config.openaiModel, config.systemPrompt, config.apiProvider);
    
    // 4. 生成氛围感标题
    const atmosphereTitles = await generateAtmosphereTitles(cleanedPageData, config.openaiKey, config.openaiModel, config.apiProvider);
    
    // 5. 发送到飞书
    await sendToFeishu(summary, atmosphereTitles, cleanedPageData, config);
    
    return { success: true };
  } catch (error) {
    console.error('处理失败:', error);
    return { success: false, error: error.message };
  }
}

// 从页面提取内容
async function extractPageContent(tabId) {
  return new Promise((resolve, reject) => {
    function sendMessage(needInjection) {
      chrome.tabs.sendMessage(tabId, { action: 'extractContent' }, (response) => {
        if (chrome.runtime.lastError) {
          // 如果没有内容脚本响应，尝试重新注入后再试一次
          if (needInjection) {
            console.log('未检测到内容脚本，尝试重新注入:', chrome.runtime.lastError);
            chrome.scripting.executeScript({
              target: { tabId },
              files: ['content.js']
            }, () => {
              if (chrome.runtime.lastError) {
                reject(new Error('无法访问页面内容，请刷新页面后重试'));
              } else {
                // 注入成功后再次尝试发送消息
                sendMessage(false);
              }
            });
          } else {
            reject(new Error('无法访问页面内容，请刷新页面后重试'));
          }
          return;
        }

        if (response && response.success) {
          resolve(response.data);
        } else {
          reject(new Error(response?.error || '提取页面内容失败'));
        }
      });
    }

    // 初次尝试，如果失败则注入content脚本后再试一次
    sendMessage(true);
  });
}

// 过滤和清理内容
function filterAndCleanContent(pageData) {
  // 敏感词汇列表（可以根据需要扩展）
  const sensitiveWords = [
    'porn'
  ];
  
  // 检查标题和内容是否包含敏感词汇
  const title = pageData.title || '';
  const content = pageData.content || '';
  const combinedText = (title + ' ' + content).toLowerCase();
  
  const foundSensitiveWords = sensitiveWords.filter(word => 
    combinedText.includes(word.toLowerCase())
  );
  
  if (foundSensitiveWords.length > 0) {
    console.warn('检测到敏感词汇:', foundSensitiveWords);
    throw new Error(`内容包含敏感词汇，无法处理。检测到的词汇: ${foundSensitiveWords.join(', ')}`);
  }
  
  // 清理和截断内容
  const maxContentLength = 12000; // 增加内容长度限制
  let cleanedContent = content;
  
  if (cleanedContent.length > maxContentLength) {
    cleanedContent = cleanedContent.substring(0, maxContentLength) + '...';
    console.log('内容已截断到', maxContentLength, '字符');
  }
  
  // 移除多余的空白字符
  cleanedContent = cleanedContent.replace(/\s+/g, ' ').trim();
  
  return {
    ...pageData,
    content: cleanedContent
  };
}

// 使用AI总结内容（支持OpenAI和DeepSeek）
async function summarizeWithAI(pageData, apiKey, model = 'gpt-5-mini', systemPrompt = '', apiProvider = 'openai') {
  if (!model) {
    model = apiProvider === 'deepseek' ? 'deepseek-chat' : 'gpt-5-mini';
  }
  // 调试信息
  console.log('使用的模型:', model);
  console.log('系统提示词参数:', systemPrompt);
  console.log('系统提示词是否为空:', !systemPrompt.trim());
  console.log('使用的API服务商:', apiProvider);

  const providerName = apiProvider === 'deepseek' ? 'DeepSeek' : 'OpenAI';
  const baseUrl = apiProvider === 'deepseek' ? 'https://api.deepseek.com/v1' : 'https://api.openai.com/v1';
  
  const isEnglishModel = model.startsWith('gpt-5');

  // 根据模型选择系统提示词
  const defaultSystemPrompt = isEnglishModel
    ? `You are a professional content analysis assistant. Read the provided web page content, extract the essential meaning, and respond in English. Your reply must be valid JSON following this shape:
{
  "overview": "A concise paragraph (<=120 words) capturing the core message",
  "key_points": [
    "Exactly three bullet points (<=24 words each)",
    "Each point focuses on a distinct, high-impact insight",
    "Do not include numbering, newlines, or markdown"
  ]
}
Ensure facts stay faithful to the source, avoid redundancy, and keep the tone objective.`
    : `你是专业的内容分析助手，请阅读提供的网页文本，给出中文总结。必须输出符合以下结构的 JSON：
{
  "overview": "120字以内的导读性段落，概括全文精华",
  "key_points": [
    "恰好三条要点，每条不超过24个汉字",
    "每条聚焦不同的关键信息，不要换行",
    "不得使用序号、符号或Markdown"
  ]
}
请保持客观准确，避免出现网页原文没有的事实。`;

  const formatReminder = isEnglishModel
    ? 'Always respond with JSON matching {"overview": string, "key_points": [string, string, string]} and ensure the array contains exactly three concise items.'
    : '务必返回形如 {"overview": "...", "key_points": ["...","...","..."]} 的有效 JSON，并确保数组只包含三条精炼要点。';

  // 用户提示词
  const userPrompt = isEnglishModel
    ? `Analyze the following webpage content and produce the requested JSON summary.

Title: ${pageData.title}
URL: ${pageData.url}
Content: ${pageData.content}`
    : `请分析下列网页内容，按照JSON结构输出结果。

标题：${pageData.title}
链接：${pageData.url}
内容：${pageData.content}`;

  // 构建消息数组
  const messages = [];
  
  // 添加系统消息
  if (systemPrompt && systemPrompt.trim()) {
    console.log('使用自定义系统提示词');
    // 检查自定义提示词是否包含敏感内容
    const sensitiveInstructions = [
      'hack', 'crack', 'exploit', 'bypass', 'illegal', 'unauthorized',
      'generate', 'create', 'write', 'code', 'script', 'program'
    ];
    
    const hasSensitiveInstruction = sensitiveInstructions.some(word => 
      systemPrompt.toLowerCase().includes(word.toLowerCase())
    );
    
    if (hasSensitiveInstruction) {
      throw new Error('自定义系统提示词包含敏感指令，请修改后重试');
    }
    
    messages.push({
      role: 'system',
      content: systemPrompt.trim()
    });
    messages.push({
      role: 'system',
      content: formatReminder
    });
  } else {
    console.log('使用默认系统提示词');
    console.log('默认提示词内容:', defaultSystemPrompt.substring(0, 100) + '...');
    messages.push({
      role: 'system',
      content: defaultSystemPrompt
    });
    messages.push({
      role: 'system',
      content: formatReminder
    });
  }
  
  // 添加用户消息
  messages.push({
    role: 'user',
    content: userPrompt
  });

  // 验证模型是否可用（GPT-5系列可能有特殊访问权限要求）
  if (model.startsWith('gpt-5')) {
    console.log('使用GPT-5系列模型，跳过模型列表验证（可能需要特殊访问权限）');
  } else {
    const modelValidation = await validateModel(apiKey, model, apiProvider);
    if (!modelValidation.available) {
      throw new Error(`模型 ${model} 不可用: ${modelValidation.reason}`);
    }
  }
  
  // 添加重试机制
  let retryCount = 0;
  const maxRetries = 3;
  
  while (retryCount < maxRetries) {
    try {
      const baseTemperature = (() => {
        if (apiProvider === 'openai' && ['gpt-5', 'gpt-5-mini', 'gpt-5-nano'].includes(model)) {
          return 1.0; // GPT-5系列当前仅支持默认温度
        }
        return isEnglishModel ? 0.7 : 0.6;
      })();

      const requestBody = {
        model: model,
        messages: messages,
        max_completion_tokens: 800,
        temperature: baseTemperature,
        top_p: 1.0,
        frequency_penalty: 0.0,
        presence_penalty: 0.0
      };

      if (apiProvider === 'openai') {
        requestBody.response_format = { type: 'json_object' };
      }

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json();
        const errorMessage = errorData.error?.message || response.statusText;
        
        // 检查是否是内容政策违规错误
        if (errorMessage.includes('usage policy') || errorMessage.includes('content policy')) {
          throw new Error(`内容违反${providerName}使用政策，请尝试不同的内容或修改提示词。错误详情: ${errorMessage}`);
        }
        
        // 检查是否是API密钥错误
        if (errorMessage.includes('invalid_api_key') || errorMessage.includes('authentication')) {
          throw new Error(`${providerName} API密钥无效，请检查密钥是否正确`);
        }
        
        // 检查是否是超参数错误
        if (errorMessage.toLowerCase().includes('temperature')) {
          throw new Error(`${providerName} 参数错误: ${errorMessage}`);
        }

        // 检查是否是模型错误
        if (errorMessage.includes('model') || errorMessage.includes('not found') || errorMessage.includes('does not exist')) {
          // 尝试找到替代模型
          const alternativeModels = {
            'gpt-5': 'gpt-5-mini',
            'gpt-5-min': 'gpt-5-mini',
            'gpt-5-mini': 'gpt-5-nano',
            'gpt-5-nano': 'gpt-4o-mini',
            'gpt-4o-mini': 'gpt-5-mini',
            'gpt-4o': 'gpt-5-mini',
            'gpt-4-turbo': 'gpt-5-mini',
            'gpt-3.5-turbo': 'gpt-5-mini'
          };
          
          const alternative = alternativeModels[model] || 'gpt-5-mini';
          throw new Error(`指定的模型 ${model} 不可用，建议使用 ${alternative} 作为替代。错误详情: ${errorMessage}`);
        }
        
        // 其他错误
        throw new Error(`${providerName} API错误: ${errorMessage}`);
      }

      const data = await response.json();
      return data.choices[0].message.content;
      
    } catch (error) {
      retryCount++;
      console.log(`第 ${retryCount} 次尝试失败:`, error.message);
      
      if (retryCount >= maxRetries) {
        throw error;
      }
      
      // 等待一段时间后重试
      await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
    }
  }
}

// 生成氛围感标题
async function generateAtmosphereTitles(pageData, apiKey, model = 'gpt-5-mini', apiProvider = 'openai') {
  if (!model) {
    model = apiProvider === 'deepseek' ? 'deepseek-chat' : 'gpt-5-mini';
  }
  const providerName = apiProvider === 'deepseek' ? 'DeepSeek' : 'OpenAI';
  const baseUrl = apiProvider === 'deepseek' ? 'https://api.deepseek.com/v1' : 'https://api.openai.com/v1';
  
  // 氛围感标题生成提示词
  const atmospherePrompt = `根据所给的文本，给出具备氛围感的标题。一些帮助理解的点：
1 没爆点的就只能在氛围上下手了，读者会不会买账其实也不好说。
2 就得习惯把自己变成一个无情的素材组装机器。
要求起的标题具备氛围感，能吸引用户点击，并且和内容关联度高。
举一些标题例子，供参考：
————————————开始：以下为标题例子参考——————————————————
硅谷今夜集体失眠！互联网女皇340页AI报告猛料刷屏，大佬熬夜头秃。
斯坦福华人天团意外爆冷！AI用纯CUDA-C编内核，竟干翻PyTorch？
AI裁员这一刀，终于砍到他们身上！外媒高层一锅端，9年老记者血泪控诉
第二次Sora时刻来了！全球首款实时摄像头诞生，真人感拉满颠覆全行业
刚刚，北大校友Lilian Weng自曝公司首个产品？一篇论文未发，估值却已90亿
全球第一AI科学家天团，首战封神！2.5个月找到治盲新药，医学圈震撼
Veo 3逼真脱口秀爆火全网，网友：彻底超越恐怖谷！Sora已被完爆
星际之门内部惊人曝光：40万块GPU爆铺！奥特曼千亿豪赌险把电网干崩
AI编程新王Claude 4，深夜震撼登基！连续编码7小时，开发者惊掉下巴
震撼全网，AlphaEvolve矩阵乘法突破被证明为真！开发者用代码证实
史诗时刻！AlphaGo神之一手突现，谷歌AI颠覆科研极限？
微软老员工48岁生日被裁，妻子发帖怒斥算法裁人！全球大血洗6000人
薪酬大曝光！北美顶尖名校ML博士，5篇顶会一作，offer竟只有35万刀？
OpenAI命悬一线，微软连夜割肉！跪求OpenAI千万别分手
AI引爆全球失业潮，美国大学生毕业即失业！全球大厂联手裁员上万
全球首个AI科学家天团出道！007做实验碾压人类博士，生化环材圈巨震
清华出手，挖走美国顶尖AI研究者！前DeepMind大佬被抄底，美国人才倒流中国
毛骨悚然！o3精准破译照片位置，只靠几行Python代码？人类在AI面前已裸奔
加州AI博士一夜失身份！谷歌OpenAI学者掀「离美潮」，38万岗位消失AI优势崩塌
LeCun被痛批：你把Meta搞砸了！烧掉千亿算力，自曝折腾20年彻底失败
MIT惊人神作：AI独立提出哈密顿物理！0先验知识，一天破译人类百年理论
————————————结束：以上为标题例子参考——————————————————————————

输出:
直接输出2个氛围感标题，用逗号分隔，不要换行，不要分析，不要补充说明`;

  // 截取页面内容的前2000字符，确保API调用不会过大
  const contentPreview = pageData.content.length > 2000 ? 
    pageData.content.substring(0, 2000) + '...' : 
    pageData.content;

  const messages = [
    {
      role: 'system',
      content: atmospherePrompt
    },
    {
      role: 'user',
      content: `请为以下网页内容生成2个氛围感标题：

原始标题：${pageData.title}
网页URL：${pageData.url}
内容：${contentPreview}`
    }
  ];

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        max_completion_tokens: 200,
        temperature: 1.0,
        top_p: 1.0,
        frequency_penalty: 0.0,
        presence_penalty: 0.0
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      const errorMessage = errorData.error?.message || response.statusText;
      throw new Error(`${providerName} API错误: ${errorMessage}`);
    }

    const data = await response.json();
    const titlesText = data.choices[0].message.content.trim();
    
    // 解析返回的标题（用逗号分隔，去掉换行）
    const titles = titlesText
      .split(/[,，]/)
      .map(title => title.trim())
      .filter(title => title.length > 0)
      .slice(0, 2); // 只取前2个标题
    
    console.log('生成的氛围感标题:', titles);
    return titles;
    
  } catch (error) {
    console.error('生成氛围感标题失败:', error);
    // 如果生成失败，返回原始页面标题作为备选
    return [pageData.title, pageData.title];
  }
}

// 验证模型是否可用
async function validateModel(apiKey, model, apiProvider = 'openai') {
  try {
    const baseUrl = apiProvider === 'deepseek' ? 'https://api.deepseek.com/v1' : 'https://api.openai.com/v1';
    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });

    if (!response.ok) {
      return {
        available: false,
        reason: '无法获取模型列表，请检查API密钥'
      };
    }

    const data = await response.json();
    const availableModels = data.data.map(m => m.id);
    
    // 检查模型是否在可用列表中
    if (availableModels.includes(model)) {
      return {
        available: true,
        reason: '模型可用'
      };
    }
    
    // 如果指定模型不可用，尝试找到替代模型
    const alternativeModels = {
      'gpt-5': ['gpt-5-mini', 'gpt-5-nano', 'gpt-4o'],
      'gpt-5-mini': ['gpt-5', 'gpt-5-nano', 'gpt-4o-mini'],
      'gpt-5-nano': ['gpt-5-mini', 'gpt-4o-mini', 'gpt-4o'],
      'gpt-4o-mini': ['gpt-5-mini', 'gpt-5-nano', 'gpt-4o'],
      'gpt-4o': ['gpt-5-mini', 'gpt-5'],
      'gpt-4-turbo': ['gpt-5-mini', 'gpt-4o'],
      'gpt-3.5-turbo': ['gpt-5-mini', 'gpt-4o-mini']
    };
    
    const alternatives = alternativeModels[model] || ['gpt-4o-mini', 'gpt-3.5-turbo'];
    const availableAlternative = alternatives.find(alt => availableModels.includes(alt));
    
    if (availableAlternative) {
      return {
        available: false,
        reason: `模型不可用，建议使用 ${availableAlternative} 作为替代`
      };
    }
    
    return {
      available: false,
      reason: '模型不可用，且没有找到合适的替代模型'
    };
    
  } catch (error) {
    return {
      available: false,
      reason: `验证模型时出错: ${error.message}`
    };
  }
}

// 发送到飞书
async function sendToFeishu(summary, atmosphereTitles, pageData, config) {
  // 解析AI返回的总结内容
  const parsedSummary = parseSummary(summary);
  
  // 构建飞书消息
  const message = buildFeishuMessage(parsedSummary, atmosphereTitles, pageData);
  
  // 发送到飞书
  const response = await fetch(config.feishuWebhook, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(message)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`飞书API错误: ${response.status} ${errorText}`);
  }

  const result = await response.json();
  if (result.code !== 0) {
    throw new Error(`飞书API返回错误: ${result.msg || '未知错误'}`);
  }
}

// 解析AI返回的总结内容
function parseSummary(summary) {
  // 添加调试信息，显示原始输出
  console.log('AI原始输出:', summary);
  console.log('输出类型:', typeof summary);
  
  // 如果输入为空，返回空对象
  if (!summary) {
    console.log('输入为空，返回空对象');
    return {
      title: '',
      highlights: [],
      content: '',
      overview: '',
      keyPoints: []
    };
  }

  // 如果是对象，直接使用
  if (typeof summary === 'object') {
    console.log('输入是对象，直接使用');
    return {
      title: summary.title || '',
      highlights: summary.key_points || summary.highlights || [],
      content: summary.overview || summary.content || '',
      overview: summary.overview || summary.content || '',
      keyPoints: summary.key_points || summary.highlights || []
    };
  }

  // 如果是字符串，尝试解析JSON
  let raw = summary.trim();
  console.log('输入是字符串，尝试解析JSON:', raw);
  
  // 移除markdown代码块标记
  raw = raw.replace(/```json|```/gi, '').trim();
  
  // 提取JSON部分
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    raw = raw.slice(firstBrace, lastBrace + 1);
  }

  try {
    const parsed = JSON.parse(raw);
    console.log('JSON解析成功:', parsed);
    return {
      title: parsed.title || '',
      highlights: parsed.key_points || parsed.highlights || [],
      content: parsed.overview || parsed.content || '',
      overview: parsed.overview || parsed.content || '',
      keyPoints: parsed.key_points || parsed.highlights || []
    };
  } catch (error) {
    console.log('JSON解析失败，返回原始文本:', error.message);
    // 如果JSON解析失败，将原始文本作为内容返回
    return {
      title: '',
      highlights: [],
      content: raw,
      overview: raw,
      keyPoints: []
    };
  }
}

// 构建飞书消息
function buildFeishuMessage(summary, atmosphereTitles, pageData) {
  // 添加调试信息
  console.log('构建飞书消息 - summary:', summary);
  console.log('构建飞书消息 - atmosphereTitles:', atmosphereTitles);
  
  const sanitize = (value, fallback = '') => {
    const text = typeof value === 'string' ? value.trim() : '';
    return text || fallback;
  };

  // 直接使用氛围感标题，不做fallback处理
  const titles = Array.isArray(atmosphereTitles) ? atmosphereTitles.map(t => sanitize(t)) : [];
  const title1 = titles[0] || '标题1';
  const title2 = titles[1] || '标题2';

  // 直接使用AI返回的内容
  const overview = sanitize(summary.overview) || sanitize(summary.content) || '暂无导读';

  // 直接使用AI返回的要点
  let keyPoints = Array.isArray(summary.keyPoints) && summary.keyPoints.length > 0
    ? summary.keyPoints
    : Array.isArray(summary.highlights) ? summary.highlights : [];

  keyPoints = keyPoints
    .map(point => sanitize(point))
    .filter(point => point.length > 0);

  // 如果要点不足3个，用空字符串填充，不自动生成
  while (keyPoints.length < 3) {
    keyPoints.push('');
  }

  const lines = [
    `标题1：${title1}`,
    `标题2：${title2}`,
    '',
    `导读：${overview}`,
    '',
    '要点：'
  ];

  keyPoints.slice(0, 3).forEach((point, index) => {
    lines.push(`${index + 1}. ${point || '暂无要点'}`);
  });

  lines.push('', `链接：${pageData.url}`);

  return {
    msg_type: 'text',
    content: {
      text: lines.join('\n')
    }
  };
}
