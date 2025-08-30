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
    
    // 3. 使用OpenAI总结内容
    const summary = await summarizeWithOpenAI(cleanedPageData, config.openaiKey, config.openaiModel, config.systemPrompt);
    
    // 4. 发送到飞书
    await sendToFeishu(summary, cleanedPageData, config);
    
    return { success: true };
  } catch (error) {
    console.error('处理失败:', error);
    return { success: false, error: error.message };
  }
}

// 从页面提取内容
async function extractPageContent(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { action: 'extractContent' }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error('无法访问页面内容，请刷新页面后重试'));
        return;
      }
      
      if (response && response.success) {
        resolve(response.data);
      } else {
        reject(new Error(response?.error || '提取页面内容失败'));
      }
    });
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

// 使用OpenAI总结内容
async function summarizeWithOpenAI(pageData, apiKey, model = 'gpt-5-nano', systemPrompt = '') {
  // 调试信息
  console.log('使用的模型:', model);
  console.log('系统提示词参数:', systemPrompt);
  console.log('系统提示词是否为空:', !systemPrompt.trim());
  
  // 根据模型选择系统提示词
  let defaultSystemPrompt;
  
  if (model === 'gpt-5-nano') {
    // GPT-5-nano使用英文提示词
    defaultSystemPrompt = `You are a professional content analysis assistant. Please analyze and summarize the provided web page content intelligently.

Analysis requirements:
1. Extract 3-5 core points
2. Generate concise and accurate summaries
3. Maintain an objective and neutral tone
4. Ensure accuracy and completeness of information

Output format:
Title: [Generate a suitable title based on the content]
Highlights:
• [Point 1]
• [Point 2]
• [Point 3]
Summary: [200-word content summary]`;
  } else {
    // 其他模型使用中文提示词
    defaultSystemPrompt = `你是一个专业的内容分析助手。请对提供的网页内容进行智能分析和总结。

标题要求：
    1. 用大模型进行改写，使得标题具有吸引力，不要使用网页标题

分析要求：
1. 提取3-5个核心要点
2. 生成简洁准确的总结
3. 保持客观中性的语调
4. 确保信息准确性和完整性

输出格式：
标题：[标题]
要点：
• [要点1]
• [要点2]
• [要点3]
总结：[200字以内的内容总结]`;
  }

  // 用户提示词
  let userPrompt;
  
  if (model === 'gpt-5-nano') {
    // GPT-5-nano使用英文用户提示词
    userPrompt = `Please analyze the following web page content:

Title: ${pageData.title}
Content: ${pageData.content}

Please analyze and summarize according to the requirements.`;
  } else {
    // 其他模型使用中文用户提示词
    userPrompt = `请分析以下网页内容：

标题：${pageData.title}
内容：${pageData.content}

请按照要求进行分析和总结。`;
  }

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
  } else {
    console.log('使用默认系统提示词');
    console.log('默认提示词内容:', defaultSystemPrompt.substring(0, 100) + '...');
    messages.push({
      role: 'system',
      content: defaultSystemPrompt
    });
  }
  
  // 添加用户消息
  messages.push({
    role: 'user',
    content: userPrompt
  });

  // 验证模型是否可用（GPT-5-nano可能有特殊访问权限要求）
  if (model === 'gpt-5-nano') {
    console.log('使用GPT-5-nano模型，跳过模型列表验证（可能需要特殊访问权限）');
  } else {
    const modelValidation = await validateModel(apiKey, model);
    if (!modelValidation.available) {
      throw new Error(`模型 ${model} 不可用: ${modelValidation.reason}`);
    }
  }
  
  // 添加重试机制
  let retryCount = 0;
  const maxRetries = 3;
  
  while (retryCount < maxRetries) {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model,
          messages: messages,
          max_completion_tokens: 1000,
          temperature: (model === 'gpt-5-nano') ? 1.0 : 0.7,
          top_p: 1.0,
          frequency_penalty: 0.0,
          presence_penalty: 0.0
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        const errorMessage = errorData.error?.message || response.statusText;
        
        // 检查是否是内容政策违规错误
        if (errorMessage.includes('usage policy') || errorMessage.includes('content policy')) {
          throw new Error(`内容违反OpenAI使用政策，请尝试不同的内容或修改提示词。错误详情: ${errorMessage}`);
        }
        
        // 检查是否是API密钥错误
        if (errorMessage.includes('invalid_api_key') || errorMessage.includes('authentication')) {
          throw new Error('OpenAI API密钥无效，请检查密钥是否正确');
        }
        
        // 检查是否是模型错误
        if (errorMessage.includes('model') || errorMessage.includes('not found') || errorMessage.includes('does not exist')) {
          // 尝试找到替代模型
          const alternativeModels = {
            'gpt-5-min': 'gpt-5-nano',
            'gpt-5-nano': 'gpt-4o-mini',
            'gpt-4o-mini': 'gpt-5-nano',
            'gpt-4o': 'gpt-5-nano',
            'gpt-4-turbo': 'gpt-5-nano',
            'gpt-3.5-turbo': 'gpt-5-nano'
          };
          
          const alternative = alternativeModels[model] || 'gpt-5-nano';
          throw new Error(`指定的模型 ${model} 不可用，建议使用 ${alternative} 作为替代。错误详情: ${errorMessage}`);
        }
        
        // 其他错误
        throw new Error(`OpenAI API错误: ${errorMessage}`);
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

// 验证模型是否可用
async function validateModel(apiKey, model) {
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
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
      'gpt-5-min': ['gpt-5-nano', 'gpt-4o-mini', 'gpt-4o'],
      'gpt-5-nano': ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'],
      'gpt-4o-mini': ['gpt-5-nano', 'gpt-4o', 'gpt-3.5-turbo'],
      'gpt-4o': ['gpt-5-nano', 'gpt-4o-mini', 'gpt-3.5-turbo'],
      'gpt-4-turbo': ['gpt-5-nano', 'gpt-4o', 'gpt-4o-mini'],
      'gpt-3.5-turbo': ['gpt-5-nano', 'gpt-4o-mini', 'gpt-4o']
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
async function sendToFeishu(summary, pageData, config) {
  // 解析OpenAI返回的总结内容
  const parsedSummary = parseSummary(summary);
  
  // 构建飞书消息
  const message = buildFeishuMessage(parsedSummary, pageData);
  
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

// 解析OpenAI返回的总结内容
function parseSummary(summary) {
  const lines = summary.split('\n');
  let title = '';
  let highlights = [];
  let content = '';
  
  let currentSection = '';
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // 支持中文和英文格式
    if (trimmedLine.startsWith('标题：') || trimmedLine.startsWith('Title:')) {
      title = trimmedLine.replace(/^标题：|^Title:\s*/i, '').trim();
    } else if (trimmedLine.startsWith('要点：') || trimmedLine.startsWith('Highlights:')) {
      currentSection = 'highlights';
    } else if (trimmedLine.startsWith('总结：') || trimmedLine.startsWith('Summary:')) {
      currentSection = 'content';
      content = trimmedLine.replace(/^总结：|^Summary:\s*/i, '').trim();
    } else if (currentSection === 'highlights' && trimmedLine.startsWith('•')) {
      highlights.push(trimmedLine.replace('•', '').trim());
    } else if (currentSection === 'content' && content) {
      content += ' ' + trimmedLine;
    }
  }
  
  return {
    title: title || '页面分析',
    highlights,
    content: content || summary
  };
}

// 构建飞书消息
function buildFeishuMessage(summary, pageData) {
  const message = {
    msg_type: 'post',
    content: {
      post: {
        zh_cn: {
          title: summary.title,
          content: []
        }
      }
    }
  };

  // 添加标题
  message.content.post.zh_cn.content.push([
    {
      tag: 'text',
      text: summary.title,
      un_escape: true
    }
  ]);

  // 添加要点
  if (summary.highlights.length > 0) {
    message.content.post.zh_cn.content.push([
      {
        tag: 'text',
        text: '\n\n📌 要点：',
        un_escape: true
      }
    ]);
    
    summary.highlights.forEach(highlight => {
      message.content.post.zh_cn.content.push([
        {
          tag: 'text',
          text: `\n• ${highlight}`,
          un_escape: true
        }
      ]);
    });
  }

  // 添加总结内容
  if (summary.content) {
    message.content.post.zh_cn.content.push([
      {
        tag: 'text',
        text: `\n\n📝 总结：\n${summary.content}`,
        un_escape: true
      }
    ]);
  }

  // 添加原文链接
  message.content.post.zh_cn.content.push([
    {
      tag: 'text',
      text: `\n\n🔗 原文链接：${pageData.url}`,
      un_escape: true
    }
  ]);

  return message;
}
