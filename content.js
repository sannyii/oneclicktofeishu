// 提取页面内容
function extractPageContent() {
  try {
    // 获取页面标题
    const title = document.title || '';
    
    // 获取页面URL
    const url = window.location.href;
    
    // 提取主要文本内容
    let content = '';
  
  // 扩展的文章内容选择器，确保全选页面所有内容
  const articleSelectors = [
    'article',
    '[role="main"]',
    '.content',
    '.post-content',
    '.article-content',
    '.entry-content',
    '.post-body',
    '.article-body',
    '.main-content',
    '.page-content',
    '.story-content',
    '.text-content',
    '.body-content',
    '.content-area',
    '.content-wrapper',
    '.main',
    '.main-area',
    '.primary-content',
    '.primary',
    '.container',
    '.wrapper'
  ];
  
  let mainContent = null;
  
  // 首先尝试找到特定的内容区域
  for (const selector of articleSelectors) {
    const element = document.querySelector(selector);
    if (element) {
      // 检查元素是否有足够的文本内容
      const textContent = element.textContent.trim();
      if (textContent.length > 100) { // 确保有足够的内容
        mainContent = element;
        console.log('找到内容区域:', selector);
        break;
      }
    }
  }
  
  // 如果没有找到特定的内容区域，尝试更智能的选择
  if (!mainContent) {
    // 查找包含最多文本的元素
    const candidates = document.querySelectorAll('div, section, main, article');
    let bestCandidate = null;
    let maxTextLength = 0;
    
    candidates.forEach(element => {
      const textContent = element.textContent.trim();
      // 排除导航、页脚、侧边栏等
      // 安全地获取className和id，确保它们是字符串
      const className = (element.className && typeof element.className === 'string') ? element.className.toLowerCase() : '';
      const id = (element.id && typeof element.id === 'string') ? element.id.toLowerCase() : '';
      
      if (!className.includes('nav') && 
          !className.includes('footer') && 
          !className.includes('sidebar') && 
          !className.includes('header') &&
          !id.includes('nav') && 
          !id.includes('footer') && 
          !id.includes('sidebar') && 
          !id.includes('header') &&
          textContent.length > maxTextLength &&
          textContent.length > 200) { // 至少200字符
        maxTextLength = textContent.length;
        bestCandidate = element;
      }
    });
    
    if (bestCandidate) {
      mainContent = bestCandidate;
      console.log('选择最佳内容区域:', bestCandidate.tagName, bestCandidate.className);
    }
  }
  
  // 如果还是没有找到合适的内容区域，使用body
  if (!mainContent) {
    mainContent = document.body;
    console.log('使用body作为内容区域');
  }
  
  // 提取文本内容，过滤掉脚本和样式
  const walker = document.createTreeWalker(
    mainContent,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        // 跳过脚本和样式标签中的文本
        const parent = node.parentElement;
        if (parent && (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE')) {
          return NodeFilter.FILTER_REJECT;
        }
        
        // 跳过导航、页脚、侧边栏等
        if (parent) {
          // 安全地获取className和id，确保它们是字符串
          const className = (parent.className && typeof parent.className === 'string') ? parent.className.toLowerCase() : '';
          const id = (parent.id && typeof parent.id === 'string') ? parent.id.toLowerCase() : '';
          
          if (className.includes('nav') || 
              className.includes('footer') || 
              className.includes('sidebar') || 
              className.includes('header') ||
              id.includes('nav') || 
              id.includes('footer') || 
              id.includes('sidebar') || 
              id.includes('header')) {
            return NodeFilter.FILTER_REJECT;
          }
        }
        
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );
  
  const textNodes = [];
  let node;
  while (node = walker.nextNode()) {
    const text = node.textContent.trim();
    if (text.length > 5) { // 降低最小长度要求，确保获取更多内容
      textNodes.push(text);
    }
  }
  
  content = textNodes.join('\n\n');
  
  // 如果内容太少，尝试获取更多内容
  if (content.length < 500) {
    console.log('内容太少，尝试获取更多内容');
    // 直接获取body的所有文本内容
    const bodyText = document.body.textContent.trim();
    const lines = bodyText.split('\n').filter(line => line.trim().length > 10);
    content = lines.join('\n\n');
  }
  
  // 清理内容：移除多余的空白字符
  content = content.replace(/\s+/g, ' ').trim();
  
  // 限制内容长度，避免API调用过大
  if (content.length > 12000) { // 增加内容长度限制
    content = content.substring(0, 12000) + '...';
    console.log('内容已截断到12000字符');
  }
  
  console.log('提取的内容长度:', content.length);
  console.log('内容预览:', content.substring(0, 200) + '...');
  
  return {
    title,
    url,
    content
  };
  } catch (error) {
    console.error('提取页面内容时出错:', error);
    // 返回默认内容，避免完全失败
    return {
      title: document.title || '页面标题',
      url: window.location.href,
      content: document.body ? document.body.textContent.trim().substring(0, 5000) : '无法提取页面内容'
    };
  }
}

// 监听来自background script的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractContent') {
    try {
      console.log('开始提取页面内容...');
      const pageData = extractPageContent();
      console.log('内容提取完成，标题:', pageData.title, '内容长度:', pageData.content.length);
      sendResponse({ success: true, data: pageData });
    } catch (error) {
      console.error('内容提取失败:', error);
      sendResponse({ success: false, error: error.message });
    }
  }
  return true; // 保持消息通道开放
});

// 创建悬浮按钮
function createFloatingButton() {
  console.log('开始创建悬浮按钮...');
  
  // 检查是否已经存在悬浮按钮
  if (document.getElementById('feishu-floating-btn')) {
    console.log('悬浮按钮已存在，跳过创建');
    return;
  }

  // 获取保存的位置，如果没有则使用默认位置
  chrome.storage.sync.get(['buttonPosition'], function(result) {
    const position = result.buttonPosition || { x: 20, y: 50 }; // 默认右侧中间
    
    const button = document.createElement('div');
    button.id = 'feishu-floating-btn';
    button.innerHTML = `
      <div class="feishu-btn-icon">📝</div>
      <div class="feishu-btn-tooltip">发送到飞书</div>
      <div class="feishu-btn-drag-handle">⋮⋮</div>
    `;
    
    // 添加样式
    const style = document.createElement('style');
    style.textContent = `
      #feishu-floating-btn {
        position: fixed;
        right: ${position.x}px;
        top: ${position.y}%;
        transform: translateY(-50%);
        width: 60px;
        height: 60px;
        background: linear-gradient(135deg, #3370ff, #5c8eff);
        border-radius: 50%;
        box-shadow: 0 4px 12px rgba(51, 112, 255, 0.3);
        cursor: pointer;
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.3s ease;
        user-select: none;
      }
      
      #feishu-floating-btn:hover {
        transform: translateY(-50%) scale(1.1);
        box-shadow: 0 6px 20px rgba(51, 112, 255, 0.4);
      }
      
      #feishu-floating-btn:active {
        transform: translateY(-50%) scale(0.95);
      }
      
      #feishu-floating-btn.disabled {
        background: #ccc;
        cursor: not-allowed;
        transform: translateY(-50%) scale(0.9);
      }
      
      #feishu-floating-btn.disabled:hover {
        transform: translateY(-50%) scale(0.9);
        box-shadow: 0 4px 12px rgba(204, 204, 204, 0.3);
      }
      
      #feishu-floating-btn.dragging {
        cursor: grabbing;
        transition: none;
      }
      
      .feishu-btn-icon {
        font-size: 24px;
        color: white;
        pointer-events: none;
      }
      
      .feishu-btn-tooltip {
        position: absolute;
        right: 70px;
        top: 50%;
        transform: translateY(-50%);
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 8px 12px;
        border-radius: 6px;
        font-size: 12px;
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.3s ease;
      }
      
      #feishu-floating-btn:hover .feishu-btn-tooltip {
        opacity: 1;
      }
      
      .feishu-btn-tooltip::after {
        content: '';
        position: absolute;
        right: -4px;
        top: 50%;
        transform: translateY(-50%);
        border: 4px solid transparent;
        border-left-color: rgba(0, 0, 0, 0.8);
      }
      
      .feishu-btn-drag-handle {
        position: absolute;
        bottom: -8px;
        left: 50%;
        transform: translateX(-50%);
        font-size: 12px;
        color: rgba(255, 255, 255, 0.7);
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.3s ease;
      }
      
      #feishu-floating-btn:hover .feishu-btn-drag-handle {
        opacity: 1;
      }
    `;
    
    document.head.appendChild(style);
    document.body.appendChild(button);
    
    // 添加点击事件
    button.addEventListener('click', handleFloatingButtonClick);
    
    // 添加拖动功能
    addDragFunctionality(button);
    
    console.log('悬浮按钮已创建，添加到DOM');
    console.log('按钮元素:', button);
    console.log('按钮样式:', button.style.cssText);
  });
}

// 处理悬浮按钮点击事件
async function handleFloatingButtonClick() {
  const button = document.getElementById('feishu-floating-btn');
  
  // 如果按钮已禁用或正在拖动，直接返回
  if (button.classList.contains('disabled') || button.classList.contains('dragging')) {
    return;
  }
  
  // 禁用按钮
  button.classList.add('disabled');
  button.querySelector('.feishu-btn-icon').textContent = '⏳';
  button.querySelector('.feishu-btn-tooltip').textContent = '处理中...';
  
  try {
    // 获取配置
    const config = await getStoredConfig();

    if (!config.openaiKey) {
      showNotification('请先在扩展设置中配置API Key', 'error');
      return;
    }
    
    if (!config.feishuWebhook) {
      showNotification('请先在扩展设置中配置飞书机器人Webhook URL', 'error');
      return;
    }
    
    // 发送消息给background script处理
    const response = await chrome.runtime.sendMessage({
      action: 'processAndSend',
      tabId: null, // background script会自动获取当前标签页
      config: config
    });
    
    if (response.success) {
      showNotification('发送成功！', 'success');
    } else {
      showNotification(`发送失败: ${response.error}`, 'error');
    }
  } catch (error) {
    showNotification(`发送失败: ${error.message}`, 'error');
  } finally {
    // 恢复按钮状态
    button.classList.remove('disabled');
    button.querySelector('.feishu-btn-icon').textContent = '📝';
    button.querySelector('.feishu-btn-tooltip').textContent = '发送到飞书';
  }
}

// 获取存储的配置
function getStoredConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['openaiKey', 'deepseekKey', 'feishuWebhook', 'feishuChatId', 'openaiModel', 'systemPrompt', 'apiProvider'], function(result) {
      const provider = result.apiProvider || 'openai';
      resolve({
        openaiKey: provider === 'deepseek' ? (result.deepseekKey || '') : (result.openaiKey || ''),
        feishuWebhook: result.feishuWebhook || '',
        feishuChatId: result.feishuChatId || '',
        openaiModel: result.openaiModel || 'gpt-5-nano',
        systemPrompt: result.systemPrompt || '',
        apiProvider: provider
      });
    });
  });
}

// 显示通知
function showNotification(message, type = 'info') {
  // 移除已存在的通知
  const existingNotification = document.getElementById('feishu-notification');
  if (existingNotification) {
    existingNotification.remove();
  }
  
  const notification = document.createElement('div');
  notification.id = 'feishu-notification';
  notification.textContent = message;
  
  // 添加样式
  const style = document.createElement('style');
  style.textContent = `
    #feishu-notification {
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 8px;
      color: white;
      font-size: 14px;
      font-weight: 500;
      z-index: 10001;
      max-width: 300px;
      word-wrap: break-word;
      animation: slideIn 0.3s ease;
    }
    
    #feishu-notification.success {
      background: #52c41a;
    }
    
    #feishu-notification.error {
      background: #ff4d4f;
    }
    
    #feishu-notification.info {
      background: #1890ff;
    }
    
    @keyframes slideIn {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
  `;
  
  notification.className = type;
  document.head.appendChild(style);
  document.body.appendChild(notification);
  
  // 3秒后自动移除
  setTimeout(() => {
    if (notification.parentNode) {
      notification.remove();
    }
  }, 3000);
}

// 页面加载完成后创建悬浮按钮
console.log('Content script 已加载，当前页面状态:', document.readyState);
console.log('当前页面URL:', window.location.href);

// 立即尝试创建按钮
createFloatingButton();

// 监听页面加载事件
if (document.readyState === 'loading') {
  console.log('页面正在加载，等待DOMContentLoaded事件');
  document.addEventListener('DOMContentLoaded', () => {
    console.log('DOMContentLoaded事件触发，再次尝试创建悬浮按钮');
    createFloatingButton();
  });
}

// 监听页面完全加载事件
window.addEventListener('load', () => {
  console.log('页面完全加载完成，最终检查悬浮按钮');
  createFloatingButton();
});

// 添加额外的检查，确保按钮被创建
setTimeout(() => {
  const button = document.getElementById('feishu-floating-btn');
  if (button) {
    console.log('悬浮按钮创建成功，ID:', button.id);
  } else {
    console.log('悬浮按钮创建失败，尝试重新创建');
    createFloatingButton();
  }
}, 1000);

// 再次检查，以防万一
setTimeout(() => {
  const button = document.getElementById('feishu-floating-btn');
  if (!button) {
    console.log('2秒后悬浮按钮仍不存在，强制创建');
    createFloatingButton();
  }
}, 2000);

// 添加拖动功能
function addDragFunctionality(button) {
  let isDragging = false;
  let startX, startY, startRight, startTop;
  
  // 鼠标按下事件
  button.addEventListener('mousedown', function(e) {
    // 如果按钮被禁用，不允许拖动
    if (button.classList.contains('disabled')) {
      return;
    }
    
    // 防止触发点击事件
    e.preventDefault();
    e.stopPropagation();
    
    isDragging = true;
    button.classList.add('dragging');
    
    // 记录起始位置
    const rect = button.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startRight = window.innerWidth - rect.right;
    startTop = rect.top;
    
    // 添加全局鼠标事件监听
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    console.log('开始拖动悬浮按钮');
  });
  
  // 鼠标移动事件
  function handleMouseMove(e) {
    if (!isDragging) return;
    
    // 计算新位置
    const deltaX = startX - e.clientX;
    const deltaY = e.clientY - startY;
    
    const newRight = Math.max(0, Math.min(window.innerWidth - 60, startRight + deltaX));
    const newTop = Math.max(0, Math.min(window.innerHeight - 60, startTop + deltaY));
    
    // 更新按钮位置
    button.style.right = newRight + 'px';
    button.style.top = newTop + 'px';
    button.style.transform = 'none'; // 移除transform，使用绝对定位
  }
  
  // 鼠标释放事件
  function handleMouseUp(e) {
    if (!isDragging) return;
    
    isDragging = false;
    button.classList.remove('dragging');
    
    // 移除全局事件监听
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    
    // 保存新位置
    const rect = button.getBoundingClientRect();
    const newPosition = {
      x: window.innerWidth - rect.right,
      y: (rect.top / window.innerHeight) * 100
    };
    
    // 保存到存储
    chrome.storage.sync.set({ buttonPosition: newPosition }, function() {
      console.log('按钮位置已保存:', newPosition);
    });
    
    console.log('拖动结束，新位置:', newPosition);
  }
  
  // 添加触摸支持（移动设备）
  button.addEventListener('touchstart', function(e) {
    if (button.classList.contains('disabled')) {
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    isDragging = true;
    button.classList.add('dragging');
    
    const touch = e.touches[0];
    const rect = button.getBoundingClientRect();
    startX = touch.clientX;
    startY = touch.clientY;
    startRight = window.innerWidth - rect.right;
    startTop = rect.top;
    
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
    
    console.log('开始触摸拖动悬浮按钮');
  });
  
  function handleTouchMove(e) {
    if (!isDragging) return;
    
    e.preventDefault();
    
    const touch = e.touches[0];
    const deltaX = startX - touch.clientX;
    const deltaY = touch.clientY - startY;
    
    const newRight = Math.max(0, Math.min(window.innerWidth - 60, startRight + deltaX));
    const newTop = Math.max(0, Math.min(window.innerHeight - 60, startTop + deltaY));
    
    button.style.right = newRight + 'px';
    button.style.top = newTop + 'px';
    button.style.transform = 'none';
  }
  
  function handleTouchEnd(e) {
    if (!isDragging) return;
    
    isDragging = false;
    button.classList.remove('dragging');
    
    document.removeEventListener('touchmove', handleTouchMove);
    document.removeEventListener('touchend', handleTouchEnd);
    
    const rect = button.getBoundingClientRect();
    const newPosition = {
      x: window.innerWidth - rect.right,
      y: (rect.top / window.innerHeight) * 100
    };
    
    chrome.storage.sync.set({ buttonPosition: newPosition }, function() {
      console.log('按钮位置已保存:', newPosition);
    });
    
    console.log('触摸拖动结束，新位置:', newPosition);
  }
}
