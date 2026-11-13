import { messages, messagePatterns } from './messages.js';

const translatedAttributes = ['title', 'placeholder', 'aria-label', 'alt'];
const preserved = 'script, style, svg, .katex, [data-i18n-keep]';
const translationsByInitial = new Map();
const localizeArguments = new Set([
  '已切换至{0}模式', '已生成随机探索函数:「{0}」',
  '打开项目失败: {0}', '保存失败: {0}', '积分计算: {0}',
  '混合: {0} ⊗ {1}', '形变混合: {0} ➔ {1}', '已创建融合模型 [{0}]，混合系数 α 已绑定平滑关键帧动画'
]);
let locale = 'zh-CN';

for (const [source, translations] of Object.entries(messagePatterns)) {
  const numbers = [];
  const parts = source.split(/(\{\d+\})/).map(part => {
    const placeholder = /^\{(\d+)\}$/.exec(part);
    if (placeholder) {
      numbers.push(Number(placeholder[1]));
      return '([\\s\\S]*?)';
    }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  const initial = source[0];
  if (!translationsByInitial.has(initial)) translationsByInitial.set(initial, []);
  translationsByInitial.get(initial).push({
    regex: new RegExp('^' + parts.join('') + '$'),
    numbers,
    translations,
    localizeArguments: localizeArguments.has(source)
  });
}

export function translate(source) {
  const key = source.trim();
  if (!key) return source;
  const index = locale === 'en' ? 1 : 0;
  let translated = Object.hasOwn(messages, key) ? messages[key][index] : undefined;

  if (translated === undefined) {
    for (const pattern of translationsByInitial.get(key[0]) || []) {
      const match = pattern.regex.exec(key);
      if (!match) continue;
      const args = [];
      pattern.numbers.forEach((number, i) => {
        const value = match[i + 1];
        args[number] = pattern.localizeArguments ? translate(value) : value;
      });
      translated = pattern.translations[index].replace(/\{(\d+)\}/g, (_, number) => args[Number(number)]);
      break;
    }
  }
  if (translated === undefined || translated === key) return source;
  const offset = source.indexOf(key);
  return source.slice(0, offset) + translated + source.slice(offset + key.length);
}

export function getLocale() {
  return locale;
}

export class InterfaceLanguage {
  constructor(root) {
    this.root = root;
    this.originalText = new WeakMap();
    this.originalAttributes = new WeakMap();
    this.observer = new MutationObserver(changes => this.translateChanges(changes));
  }

  setLocale(language) {
    // Record any app-written text that arrived before the observer ran.
    this.translateChanges(this.observer.takeRecords());
    this.observer.disconnect();
    locale = language === 'en' ? 'en' : 'zh-CN';
    document.documentElement.lang = locale;
    this.translateTree(this.root);
    this.observer.observe(this.root, {
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: translatedAttributes,
      subtree: true
    });
  }

  translateChanges(changes) {
    for (const change of changes) {
      if (change.type === 'attributes') {
        if (!change.target.closest(preserved)) this.translateAttributes(change.target);
      } else if (change.type === 'characterData') {
        if (!change.target.parentElement?.closest(preserved)) this.translateText(change.target);
      } else if (!change.target.closest?.(preserved)) {
        for (const node of change.addedNodes) this.translateTree(node);
      }
    }
  }

  translateTree(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      this.translateText(node);
    } else if (node.nodeType === Node.ELEMENT_NODE && !node.matches(preserved)) {
      this.translateAttributes(node);
      for (const child of node.childNodes) this.translateTree(child);
    }
  }

  translateText(node) {
    const previous = this.originalText.get(node);
    const source = previous?.rendered === node.data ? previous.source : node.data;
    const rendered = translate(source);
    if (rendered !== source || previous?.source === source) {
      this.originalText.set(node, { source, rendered });
    }
    if (rendered !== node.data) node.data = rendered;
  }

  translateAttributes(element) {
    const originals = this.originalAttributes.get(element) || {};
    for (const attribute of translatedAttributes) {
      const current = element.getAttribute(attribute);
      if (current === null) {
        delete originals[attribute];
        continue;
      }
      const previous = originals[attribute];
      const source = previous?.rendered === current ? previous.source : current;
      const rendered = translate(source);
      if (rendered !== source || previous?.source === source) {
        originals[attribute] = { source, rendered };
      }
      if (rendered !== current) element.setAttribute(attribute, rendered);
    }
    if (Object.keys(originals).length) this.originalAttributes.set(element, originals);
  }
}
