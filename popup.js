document.addEventListener('DOMContentLoaded', function() {
  const openaiKeyInput = document.getElementById('openaiKey');
  const feishuWebhookInput = document.getElementById('feishuWebhook');
  const feishuChatIdInput = document.getElementById('feishuChatId');
  const openaiModelSelect = document.getElementById('openaiModel');
  const apiProviderSelect = document.getElementById('apiProvider');
  const systemPromptTextarea = document.getElementById('systemPrompt');
  const sendButton = document.getElementById('sendButton');
  const statusDiv = document.getElementById('status');

  // 加载保存的配置
  chrome.storage.sync.get(['openaiKey', 'deepseekKey', 'feishuWebhook', 'feishuChatId', 'openaiModel', 'systemPrompt', 'apiProvider'], function(result) {
    if (result.feishuWebhook) feishuWebhookInput.value = result.feishuWebhook;
    if (result.feishuChatId) feishuChatIdInput.value = result.feishuChatId;
    if (result.openaiModel) openaiModelSelect.value = result.openaiModel;
    if (result.systemPrompt) systemPromptTextarea.value = result.systemPrompt;

    const provider = result.apiProvider || 'openai';
    apiProviderSelect.value = provider;
    openaiKeyInput.value = provider === 'deepseek' ? (result.deepseekKey || '') : (result.openaiKey || '');
  });

  // 保存配置
  function saveConfig() {
    const provider = apiProviderSelect.value;
    const data = {
      feishuWebhook: feishuWebhookInput.value,
      feishuChatId: feishuChatIdInput.value,
      openaiModel: openaiModelSelect.value,
      systemPrompt: systemPromptTextarea.value,
      apiProvider: provider
    };

    if (provider === 'deepseek') {
      data.deepseekKey = openaiKeyInput.value;
    } else {
      data.openaiKey = openaiKeyInput.value;
    }

    chrome.storage.sync.set(data);
  }

  // 显示状态信息
  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.style.display = 'block';
  }

  // 隐藏状态信息
  function hideStatus() {
    statusDiv.style.display = 'none';
  }

  // 发送按钮点击事件
  sendButton.addEventListener('click', async function() {
    const openaiKey = openaiKeyInput.value.trim();
    const feishuWebhook = feishuWebhookInput.value.trim();
    const feishuChatId = feishuChatIdInput.value.trim();
    const openaiModel = openaiModelSelect.value;
    const apiProvider = apiProviderSelect.value;
    const systemPrompt = systemPromptTextarea.value.trim();
    
    // 调试信息
    console.log('系统提示词输入值:', systemPrompt);
    console.log('系统提示词是否为空:', !systemPrompt);

    if (!openaiKey) {
      showStatus('请输入API Key', 'error');
      return;
    }

    if (!feishuWebhook) {
      showStatus('请输入飞书机器人Webhook URL', 'error');
      return;
    }

    // 保存配置
    saveConfig();

    // 禁用按钮并显示加载状态
    sendButton.disabled = true;
    showStatus('正在处理页面内容...', 'loading');

    try {
      // 获取当前标签页
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // 发送消息给background script处理
      const response = await chrome.runtime.sendMessage({
        action: 'processAndSend',
        tabId: tab.id,
        config: {
          openaiKey,
          feishuWebhook,
          feishuChatId,
          openaiModel,
          apiProvider,
          systemPrompt
        }
      });

      if (response.success) {
        showStatus('发送成功！', 'success');
      } else {
        showStatus(`发送失败: ${response.error}`, 'error');
      }
    } catch (error) {
      showStatus(`发送失败: ${error.message}`, 'error');
    } finally {
      sendButton.disabled = false;
    }
  });

  // 输入框变化时自动保存
  openaiKeyInput.addEventListener('input', saveConfig);
  feishuWebhookInput.addEventListener('input', saveConfig);
  feishuChatIdInput.addEventListener('input', saveConfig);
  openaiModelSelect.addEventListener('change', saveConfig);
  systemPromptTextarea.addEventListener('input', saveConfig);

  apiProviderSelect.addEventListener('change', function() {
    chrome.storage.sync.get(['openaiKey', 'deepseekKey'], function(result) {
      openaiKeyInput.value = apiProviderSelect.value === 'deepseek' ? (result.deepseekKey || '') : (result.openaiKey || '');
      saveConfig();
    });
  });
});
