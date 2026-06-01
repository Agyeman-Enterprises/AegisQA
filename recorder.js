/**
 * AegisQA High-Fidelity Interaction Recorder Content Script
 * Captures clicks, text entry (blurs/inputs), select changes, checkboxes in the capture phase.
 * Produces deterministic, framework-resilient locators.
 */

(function() {
  if (window.hasLiveActionRecorderAttached) return;
  window.hasLiveActionRecorderAttached = true;

  console.log('AegisQA Recording Engine successfully attached.');

  // Global flag to track last click for relative actions (like assertions)
  let lastInteractedElement = null;

  // 1. Click Listener (Capture Phase)
  document.addEventListener('click', (event) => {
    const element = event.target;
    
    // Ignore base document tags
    if (element.tagName === 'BODY' || element.tagName === 'HTML') return;
    
    lastInteractedElement = element;
    
    // Determine type: Checkbox, Radio, or Generic Click
    let type = 'CLICK';
    let text = undefined;
    
    if (element.tagName === 'INPUT' && (element.type === 'checkbox' || element.type === 'radio')) {
      type = element.checked ? 'CHECK' : 'UNCHECK';
    }

    const selector = calculateSelector(element);
    const textHint = element.innerText ? element.innerText.substring(0, 30).trim() : '';

    chrome.runtime.sendMessage({
      type: 'RECORDED_STEP',
      step: {
        type,
        selector,
        tagName: element.tagName.toLowerCase(),
        textHint,
        text
      }
    });
  }, true);

  // 2. Text Input Listener (Capture Phase - Blur to capture complete values)
  document.addEventListener('blur', (event) => {
    const element = event.target;
    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      // Ignore passwords for basic redaction, or record with standard indicators
      if (element.type === 'password') {
        // Record typing placeholder but redact characters
        const selector = calculateSelector(element);
        chrome.runtime.sendMessage({
          type: 'RECORDED_STEP',
          step: {
            type: 'TYPE',
            selector,
            text: '********', // Redacted
            tagName: element.tagName.toLowerCase()
          }
        });
        return;
      }

      if (!element.value) return;
      
      const selector = calculateSelector(element);
      chrome.runtime.sendMessage({
        type: 'RECORDED_STEP',
        step: {
          type: 'TYPE',
          selector,
          text: element.value,
          tagName: element.tagName.toLowerCase()
        }
      });
    }
  }, true);

  // 3. Dropdown Selection Changes (Capture Phase)
  document.addEventListener('change', (event) => {
    const element = event.target;
    if (element.tagName === 'SELECT') {
      const selector = calculateSelector(element);
      const selectedText = element.options[element.selectedIndex]?.text || '';
      chrome.runtime.sendMessage({
        type: 'RECORDED_STEP',
        step: {
          type: 'TYPE', // Replayed as choosing focus + click or direct focus value change
          selector,
          text: element.value,
          tagName: 'select',
          textHint: selectedText
        }
      });
    }
  }, true);

  // Helper: Smart Selector Strategy Generator
  function calculateSelector(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';

    // Strategy 1: Unique global ID
    if (el.id && !isDynamicValue(el.id)) {
      return `#${el.id}`;
    }

    // Strategy 2: Framework/QA Semantic Data Attributes
    const qaAttrs = ['data-testid', 'data-cy', 'data-qa', 'name', 'placeholder'];
    for (const attr of qaAttrs) {
      if (el.hasAttribute(attr)) {
        const val = el.getAttribute(attr);
        if (val && !isDynamicValue(val)) {
          return `${el.tagName.toLowerCase()}[${attr}='${val}']`;
        }
      }
    }

    // Strategy 3: ARIA accessibility roles & names
    if (el.hasAttribute('role')) {
      const role = el.getAttribute('role');
      if (el.hasAttribute('aria-label')) {
        return `${el.tagName.toLowerCase()}[role='${role}'][aria-label='${el.getAttribute('aria-label')}']`;
      }
    }

    // Strategy 4: Relative selector healing - associated label for inputs
    if (el.tagName === 'INPUT' && el.parentNode) {
      const label = findLabelForInput(el);
      if (label && label.innerText) {
        const labelText = label.innerText.trim().replace(/\s+/g, ' ');
        // If we can locate the input relative to this label text
        // we keep standard fallback
      }
    }

    // Strategy 5: Class selector (cleansed of Tailwind states and layout utilities)
    if (el.className && typeof el.className === 'string') {
      const cleanClasses = el.className.split(/\s+/)
        .filter(c => c && !isDynamicClass(c) && !isLayoutOrUtilityClass(c));
      if (cleanClasses.length > 0) {
        const classSelector = `${el.tagName.toLowerCase()}.${cleanClasses.join('.')}`;
        // Validate if this class is unique enough
        try {
          if (document.querySelectorAll(classSelector).length === 1) {
            return classSelector;
          }
        } catch (e) {}
      }
    }

    // Strategy 6: Hierarchical path fallback with index (nth-of-type)
    const path = [];
    let current = el;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      if (current.tagName === 'BODY' || current.tagName === 'HTML') {
        break;
      }
      
      let tagName = current.tagName.toLowerCase();
      
      // Try to find a local QA attr first for intermediate parent nodes
      let localAttr = '';
      for (const attr of ['data-testid', 'data-cy', 'data-qa']) {
        if (current.hasAttribute(attr)) {
          localAttr = `[${attr}='${current.getAttribute(attr)}']`;
          break;
        }
      }

      if (localAttr) {
        path.unshift(`${tagName}${localAttr}`);
        break; // Stop climbing if we hit a strong semantic anchor!
      }

      // Check siblings for indexing
      let sibCount = 0;
      let sibIndex = 0;
      let sibling = current.parentNode ? current.parentNode.firstChild : null;
      while (sibling) {
        if (sibling.nodeType === Node.ELEMENT_NODE && sibling.tagName === current.tagName) {
          sibCount++;
          if (sibling === current) {
            sibIndex = sibCount;
          }
        }
        sibling = sibling.nextSibling;
      }

      let selectorPiece = tagName;
      if (sibCount > 1) {
        selectorPiece += `:nth-of-type(${sibIndex})`;
      }
      
      path.unshift(selectorPiece);
      current = current.parentNode;
    }
    
    return path.join(' > ');
  }

  // Detects random dynamic hashes (e.g. ember123, react-34ef8b, vue-abc)
  function isDynamicValue(val) {
    if (!val) return true;
    // Regex for random UUIDs, dynamic digits, or typical framework generated keys
    const patterns = [
      /^[0-9]+$/,                    // Only numbers
      /^[a-f0-9]{8,32}$/i,           // Hex hashes
      /^(ember|react|vue|angular|__)/i, // typical prefix
      /_[a-z0-9]{5,10}$/i,           // suffix hashes
      /-[a-z0-9]{5,10}$/i,
      /[a-f0-9]{4,8}-[a-f0-9]{4,8}/i // uuid snippets
    ];
    return patterns.some(p => p.test(val));
  }

  // Detects dynamic classes (e.g. animation, dynamic colors, active/focused states)
  function isDynamicClass(cls) {
    const dynamicPatterns = [
      /active/, /focus/, /hover/, /selected/, /open/, /loading/, /transition/, /animate/,
      /svelte-/, /css-/, /jsx-/, /ng-/, /_react/
    ];
    return dynamicPatterns.some(p => p.test(cls));
  }

  // Detects tailwind classes and pure structural layout utilities that clutter locators
  function isLayoutOrUtilityClass(cls) {
    const tailwindPrefixes = [
      /^bg-/, /^text-/, /^border-/, /^p-/, /^m-/, /^w-/, /^h-/, /^flex/, /^grid/,
      /^shadow/, /^rounded/, /^opacity/, /^cursor/, /^z-/, /^top-/, /^left-/,
      /^justify-/, /^items-/, /^gap-/, /^font-/, /^leading-/, /^overflow-/
    ];
    return tailwindPrefixes.some(p => p.test(cls));
  }

  // Helper to find associated label for input elements
  function findLabelForInput(inputEl) {
    if (inputEl.id) {
      const label = document.querySelector(`label[for='${inputEl.id}']`);
      if (label) return label;
    }
    // Climb up to find wrapping label
    let parent = inputEl.parentNode;
    while (parent) {
      if (parent.tagName === 'LABEL') return parent;
      parent = parent.parentNode;
    }
    return null;
  }
})();
