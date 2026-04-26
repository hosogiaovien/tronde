import JSZip from 'jszip';
import { saveAs } from 'file-saver';

interface CharMapping {
  rNode: Element;
  node: Element;
  isText: boolean;
  charIndex: number;
}

function getTextMapping(pNode: Element) {
  let text = '';
  const charMap: CharMapping[] = [];
  
  function traverse(node: Element, currentRNode: Element | null) {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType !== 1) continue; // Only elements
      const el = child as Element;
      const nodeName = el.nodeName.replace(/^.*:/, ''); 
      
      let nextRNode = currentRNode;
      if (nodeName === 'r') {
        nextRNode = el;
      }
      
      if (nodeName === 't') {
        const content = el.textContent || '';
        for (let i = 0; i < content.length; i++) {
          charMap.push({ rNode: currentRNode || el, node: el, isText: true, charIndex: i });
          text += content[i];
        }
      } else if (nodeName === 'tab') {
        charMap.push({ rNode: currentRNode || el, node: el, isText: false, charIndex: 0 });
        text += '\t';
      } else if (nodeName === 'drawing' || nodeName === 'pict' || nodeName === 'object') {
        charMap.push({ rNode: currentRNode || el, node: el, isText: false, charIndex: 0 });
        text += ' ';
      } else {
        traverse(el, nextRNode);
      }
    }
  }
  traverse(pNode, null);
  return { text, charMap };
}

function splitParagraphOptions(pNode: Element): Element[] {
  const { text, charMap } = getTextMapping(pNode);
  
  const regexTest = /(^|[\s\t\xA0\u200B\uFEFF])([A-D][\.\:])/g;
  let matchesCount = 0;
  regexTest.lastIndex = 0;
  while(regexTest.exec(text) !== null) {
      matchesCount++;
  }
  
  if (matchesCount <= 1) {
    return [pNode];
  }
  
  const boundaries: { label: string, startIndex: number, labelIndex: number }[] = [];
  const regex = /(^|[\s\t\xA0\u200B\uFEFF]+)([A-D][\.\:])/g;
  let match;
  regex.lastIndex = 0;
  while ((match = regex.exec(text)) !== null) {
    const startIndex = match.index;
    const labelIndex = match.index + match[1].length;
    const label = match[2].charAt(0).toUpperCase();
    boundaries.push({ label, startIndex, labelIndex });
  }
  
  if (boundaries.length <= 1) {
    return [pNode];
  }
  
  const chunks: {start: number, end: number, label: string | null}[] = [];
  if (boundaries[0].startIndex > 0) {
    chunks.push({ start: 0, end: boundaries[0].startIndex, label: null });
  }
  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i].labelIndex;
    const end = i + 1 < boundaries.length ? boundaries[i+1].startIndex : text.length;
    chunks.push({ start, end, label: boundaries[i].label });
  }
  
  const newPNodes: Element[] = [];
  
  for (const chunk of chunks) {
    const newP = pNode.cloneNode(true) as Element;
    const { charMap: newCharMap } = getTextMapping(newP);
    
    const tNodeToKeptChars = new Map<Element, string[]>();
    const nodesToRemove = new Set<Element>();
    const nodesToKeep = new Set<Element>();
    
    for (let i = 0; i < text.length; i++) {
       const map = newCharMap[i];
       if (!map) continue;
       const isInside = i >= chunk.start && i < chunk.end;
       
       if (isInside) {
         nodesToKeep.add(map.node);
         if (map.isText) {
             let charsArray = tNodeToKeptChars.get(map.node);
             if (!charsArray) {
                charsArray = new Array((map.node.textContent || '').length).fill('');
                tNodeToKeptChars.set(map.node, charsArray);
             }
             charsArray[map.charIndex] = text[i];
         }
       } else {
         if (!map.isText) {
             nodesToRemove.add(map.node);
         }
       }
    }
    
    for (const node of nodesToRemove) {
       if (!nodesToKeep.has(node) && node.parentNode) {
          node.parentNode.removeChild(node);
       }
    }
    
    for (let i = 0; i < newCharMap.length; i++) {
        const map = newCharMap[i];
        if (map.isText) {
            if (tNodeToKeptChars.has(map.node)) {
                map.node.textContent = tNodeToKeptChars.get(map.node)!.join('');
                tNodeToKeptChars.delete(map.node); 
            } else if (!nodesToKeep.has(map.node)) {
                map.node.textContent = '';
            }
        }
    }
    
    if (chunk.label === null) {
       const chunkText = text.substring(chunk.start, chunk.end);
       if (chunkText.trim() === '') {
          continue; 
       }
    }
    
    newPNodes.push(newP);
  }
  
  return newPNodes;
}

function isCorrectOption(nodes: Element[]): boolean {
  for (const node of nodes) {
    const runs = Array.from(node.getElementsByTagName('w:r')).concat(Array.from(node.getElementsByTagName('r')));
    for (const r of runs) {
      const textContent = r.textContent || '';
      const hasDrawing = r.getElementsByTagName('w:drawing').length > 0 || r.getElementsByTagName('v:shape').length > 0;
      if (textContent.trim() === '' && !hasDrawing) {
         continue; // skip empty or whitespace-only runs
      }
      
      const runProps = r.getElementsByTagName('w:rPr')[0] || r.getElementsByTagName('rPr')[0];
      if (runProps) {
        const u = runProps.getElementsByTagName('w:u')[0] || runProps.getElementsByTagName('u')[0];
        if (u) {
          const val = u.getAttribute('w:val');
          if (val && val !== 'none') return true;
          if (!val) return true; // <w:u /> without val usually implies single
        }
      }
    }
  }
  return false;
}

function removeUnderline(nodes: Element[]) {
  for (const node of nodes) {
    const runs = Array.from(node.getElementsByTagName('w:r')).concat(Array.from(node.getElementsByTagName('r')));
    for (const r of runs) {
      const runProps = r.getElementsByTagName('w:rPr')[0] || r.getElementsByTagName('rPr')[0];
      if (runProps) {
        const uTags = Array.from(runProps.getElementsByTagName('w:u')).concat(Array.from(runProps.getElementsByTagName('u')));
        for (const u of uTags) {
          u.parentNode?.removeChild(u);
        }
      }
    }
  }
}

function replacePrefix(paragraphNode: Element, regex: RegExp, newPrefix: string, format: { underline?: boolean, bold?: boolean, color?: string, addTab?: boolean, autoNum?: boolean, qIndex?: number } | null = null, xmlDoc?: Document) {
  const runs = Array.from(paragraphNode.getElementsByTagName('w:t')).concat(Array.from(paragraphNode.getElementsByTagName('t')));
  if (runs.length === 0) return;

  let combined = '';
  for (const t of runs) {
    combined += t.textContent || '';
  }

  const match = combined.match(regex);
  if (!match) return;

  const oldPrefixLength = match[0].length;
  let remainingToRemove = oldPrefixLength;

  for (let i = 0; i < runs.length; i++) {
    const t = runs[i];
    if (remainingToRemove > 0) {
      const tText = t.textContent || '';
      if (tText.length <= remainingToRemove) {
        remainingToRemove -= tText.length;
        t.textContent = '';
      } else {
        const textToKeep = tText.substring(remainingToRemove);
        t.textContent = textToKeep;
        remainingToRemove = 0;
      }
    }
  }

  if (xmlDoc && format) {
     const firstRun = runs[0].parentNode as Element;
     const rNode = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:r');
     let rPr = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:rPr');
     
     const existingRPr = firstRun.getElementsByTagName('w:rPr')[0] || firstRun.getElementsByTagName('rPr')[0];
     if (existingRPr) {
         Array.from(existingRPr.cloneNode(true).childNodes).forEach(c => rPr.appendChild(c));
     }

     if (format.underline) {
        let u = rPr.getElementsByTagName('w:u')[0];
        if (!u) {
          u = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:u');
          rPr.appendChild(u);
        }
        u.setAttribute('w:val', 'single');
     }
     if (format.bold) {
        let b = rPr.getElementsByTagName('w:b')[0];
        if (!b) {
          b = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:b');
          rPr.appendChild(b);
        }
        let bCs = rPr.getElementsByTagName('w:bCs')[0];
        if (!bCs) {
          bCs = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:bCs');
          rPr.appendChild(bCs);
        }
     }
     if (format.color) {
        Array.from(rPr.getElementsByTagName('w:color')).forEach(c => c.parentNode?.removeChild(c));
        const color = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:color');
        color.setAttribute('w:val', format.color);
        rPr.appendChild(color);
     }
     
     rNode.appendChild(rPr);
     
     if (format.autoNum) {
         const tNode1 = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:t');
         tNode1.setAttribute('xml:space', 'preserve');
         tNode1.textContent = 'Câu ';
         rNode.appendChild(tNode1);
         
         const fldCharBegin = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:fldChar');
         fldCharBegin.setAttribute('w:fldCharType', 'begin');
         rNode.appendChild(fldCharBegin);
         
         const instrText = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:instrText');
         instrText.setAttribute('xml:space', 'preserve');
         instrText.textContent = ' SEQ Cau \\* Arabic ';
         rNode.appendChild(instrText);
         
         const fldCharSep = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:fldChar');
         fldCharSep.setAttribute('w:fldCharType', 'separate');
         rNode.appendChild(fldCharSep);
         
         const tNode2 = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:t');
         tNode2.textContent = (format.qIndex !== undefined ? format.qIndex + 1 : 1).toString();
         rNode.appendChild(tNode2);
         
         const fldCharEnd = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:fldChar');
         fldCharEnd.setAttribute('w:fldCharType', 'end');
         rNode.appendChild(fldCharEnd);
         
         const tNode3 = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:t');
         tNode3.setAttribute('xml:space', 'preserve');
         tNode3.textContent = '. ';
         rNode.appendChild(tNode3);
     } else {
         const tNode = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:t');
         tNode.setAttribute('xml:space', 'preserve');
         tNode.textContent = format.addTab ? newPrefix.trim() : newPrefix;
         rNode.appendChild(tNode);
         
         if (format.addTab) {
            const tabNode = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:tab');
            rNode.appendChild(tabNode);
         }
     }
     
     firstRun.parentNode?.insertBefore(rNode, firstRun);
  } else {
     runs[0].textContent = newPrefix + (runs[0].textContent || '');
  }
}

function applyFormatToRun(rNode: Element, xmlDoc: Document, format: { underline?: boolean, color?: string, bold?: boolean }) {
  if (!rNode) return;
  let rPr = rNode.getElementsByTagName('w:rPr')[0] || rNode.getElementsByTagName('rPr')[0];
  if (!rPr) {
    rPr = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:rPr');
    rNode.insertBefore(rPr, rNode.firstChild);
  }
  
  if (format.underline) {
    let u = rPr.getElementsByTagName('w:u')[0] || rPr.getElementsByTagName('u')[0];
    if (!u) {
      u = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:u');
      u.setAttribute('w:val', 'single');
      rPr.appendChild(u);
    } else {
      u.setAttribute('w:val', 'single');
    }
  }
  
  if (format.color) {
    let color = rPr.getElementsByTagName('w:color')[0] || rPr.getElementsByTagName('color')[0];
    if (!color) {
      color = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:color');
      color.setAttribute('w:val', format.color);
      rPr.appendChild(color);
    } else {
      color.setAttribute('w:val', format.color);
    }
  }
}

function createNodesFromXMLString(xmlDoc: Document, xmlString: string): Node[] {
  const tempDoc = new DOMParser().parseFromString(
    `<root xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${xmlString}</root>`,
    'application/xml'
  );
  return Array.from(tempDoc.documentElement.children).map((node) => xmlDoc.importNode(node, true));
}

function getBlocks(element: Element): Element[] {
  const blocks: Element[] = [];
  const children = Array.from(element.children);
  for (const child of children) {
    const nodeName = child.nodeName.replace(/^.*:/, '');
    if (nodeName === 'p') {
      blocks.push(child);
    } else if (nodeName === 'tbl') {
      const text = child.textContent || '';
      if (/^\s*c[aâAÂ]u\s*\d+/i.test(text)) {
        // Find all p inside this table since it contains a question
        const descendants = Array.from(child.getElementsByTagName('*'));
        for (const desc of descendants) {
           if (desc.nodeName.replace(/^.*:/, '') === 'p') {
             blocks.push(desc);
           }
        }
      } else {
        blocks.push(child);
      }
    } else if (nodeName === 'sectPr') {
      blocks.push(child);
    } else {
      blocks.push(...getBlocks(child));
    }
  }
  return blocks;
}

export interface ParseResult {
  questions: any[];
  preQuestionNodes: Element[];
  postQuestionNodes: Element[];
  body: Element;
  xmlDoc: Document;
}

export function parseQuestions(xmlDoc: Document): ParseResult {
  const body = xmlDoc.getElementsByTagName('w:body')[0] || xmlDoc.getElementsByTagName('body')[0];
  const originalBodyChildren = getBlocks(body);
  const bodyChildren: Element[] = [];

  for (const node of originalBodyChildren) {
    const nodeName = node.nodeName.replace(/^.*:/, '');
    if (nodeName === 'p') {
      const splitNodes = splitParagraphOptions(node);
      bodyChildren.push(...splitNodes);
    } else {
      bodyChildren.push(node);
    }
  }

  const questions: any[] = [];
  const preQuestionNodes: Element[] = [];
  const postQuestionNodes: Element[] = [];
  let pendingNodes: Element[] = [];
  let currentQuestion: any = null;
  let currentPart: string | null = null;
  let foundDebugStats = { pCount: 0, textSample: '' };

  for (const node of bodyChildren) {
    const nodeName = node.nodeName.replace(/^.*:/, '');
    if (nodeName === 'sectPr') {
      postQuestionNodes.push(node);
      continue;
    }

    const { text } = getTextMapping(node);
    const cleanText = text.replace(/^[\s\t\xA0\u200B\uFEFF]+/, '');
    
    if (foundDebugStats.pCount < 5 && cleanText.length > 0) {
      foundDebugStats.pCount++;
      foundDebugStats.textSample += cleanText.substring(0, 30) + ' | ';
    }

    const optMatch = cleanText.match(/^([A-D])[\.\:]/i);
    
    if (optMatch) {
       const opt = optMatch[1].toUpperCase();
       
       if (!currentQuestion) {
           let splitIdx = 0;
           for (let i = pendingNodes.length - 1; i >= 0; i--) {
               const { text: pt } = getTextMapping(pendingNodes[i]);
               const ptClean = pt.replace(/^[\s\t\xA0\u200B\uFEFF]+/, '');
               if (/^(c[aâAÂ]u|b[aàAÀ]i|q)\s*\d+/i.test(ptClean) || /^\d+[\.\:]\s/.test(ptClean) || pendingNodes[i].getElementsByTagName('w:numPr').length > 0) {
                   splitIdx = i;
                   break;
               }
           }
           if (splitIdx === 0 && pendingNodes.length > 0) {
               const { text: pt } = getTextMapping(pendingNodes[0]);
               const ptClean = pt.replace(/^[\s\t\xA0\u200B\uFEFF]+/, '');
               if (!(/^(c[aâAÂ]u|b[aàAÀ]i|q)\s*\d+/i.test(ptClean) || /^\d+[\.\:]\s/.test(ptClean) || pendingNodes[0].getElementsByTagName('w:numPr').length > 0)) {
                   splitIdx = pendingNodes.length - 1;
               }
           }
           
           preQuestionNodes.push(...pendingNodes.slice(0, splitIdx));
           currentQuestion = { header: pendingNodes.slice(splitIdx), A: [], B: [], C: [], D: [] };
           pendingNodes = [];
           
       } else if (opt === 'A' && currentQuestion.A.length > 0) {
           questions.push(currentQuestion);
           currentQuestion = { header: [...pendingNodes], A: [], B: [], C: [], D: [] };
           pendingNodes = [];
       } else if (pendingNodes.length > 0) {
           if (currentPart && currentQuestion[currentPart]) {
               currentQuestion[currentPart].push(...pendingNodes);
           }
           pendingNodes = [];
       }

       currentPart = opt;
       currentQuestion[currentPart].push(node);

    } else {
       const isHeader = /^(c[aâAÂ]u|b[aàAÀ]i|q)\s*\d+/i.test(cleanText) || /^\d+[\.\:]\s/.test(cleanText) || node.getElementsByTagName('w:numPr').length > 0;
       
       if (currentQuestion && currentPart && isHeader) {
           questions.push(currentQuestion);
           currentQuestion = null;
           currentPart = null;
           pendingNodes.push(node);
       } else if (currentQuestion && currentPart) {
           currentQuestion[currentPart].push(node);
       } else {
           pendingNodes.push(node);
       }
    }
  }

  if (currentQuestion) {
      if (pendingNodes.length > 0 && currentPart) {
          currentQuestion[currentPart].push(...pendingNodes);
      }
      questions.push(currentQuestion);
  } else {
      preQuestionNodes.push(...pendingNodes);
  }

  questions.forEach((q, index) => {
    q.origIndex = index;
    if (isCorrectOption(q.A)) q.origCorrect = 'A';
    else if (isCorrectOption(q.B)) q.origCorrect = 'B';
    else if (isCorrectOption(q.C)) q.origCorrect = 'C';
    else if (isCorrectOption(q.D)) q.origCorrect = 'D';
    else q.origCorrect = 'A'; // fallback

    removeUnderline([...q.A, ...q.B, ...q.C, ...q.D]);
  });

  return { questions, preQuestionNodes, postQuestionNodes, body, xmlDoc, debugSample: foundDebugStats.textSample };
}

function getOptionLength(nodes: Element[]): number {
  if (!nodes || nodes.length === 0) return 9999;
  
  let hasBlockElements = false;
  nodes.forEach(n => {
      const nodeName = n.nodeName.replace(/^.*:/, '');
      if (nodeName === 'tbl' || n.getElementsByTagName('w:tbl').length > 0) {
          hasBlockElements = true;
      }
  });
  if (hasBlockElements) return 9999;

  const validNodes = nodes.filter(node => {
     const text = node.textContent || '';
     const drawings = node.getElementsByTagName('w:drawing').length;
     const shapes = node.getElementsByTagName('v:shape').length;
     const objects = node.getElementsByTagName('w:object').length;
     const pics = node.getElementsByTagName('w:pict').length;
     const math = node.getElementsByTagName('m:oMath').length;
     return text.trim().length > 0 || (drawings + shapes + objects + pics + math) > 0;
  });

  const ps = validNodes.filter(n => n.nodeName.replace(/^.*:/, '') === 'p');
  if (ps.length > 1) return 9999;

  let length = 0;
  for (const node of validNodes) {
    let text = '';
    const textNodes = Array.from(node.getElementsByTagName('w:t')).concat(Array.from(node.getElementsByTagName('t')), Array.from(node.getElementsByTagName('m:t')));
    textNodes.forEach(t => text += t.textContent || '');
    
    length += text.trim().length;
    
    // Calculate width of w:drawing elements
    const extents = Array.from(node.getElementsByTagName('wp:extent'));
    extents.forEach(ext => {
        const cx = ext.getAttribute('cx');
        if (cx) {
            // EMUs to chars: 914400 EMUs = 1 inch = 72 pt ~= 12 chars (assuming 6pt per char)
            length += parseInt(cx) / 914400 * 12;
        }
    });

    // Calculate width of v:shape elements
    const shapes = Array.from(node.getElementsByTagName('v:shape'));
    let shapeCountFallback = 0;
    shapes.forEach(shape => {
        const style = shape.getAttribute('style') || '';
        const wMatch = style.match(/width:\s*([\d\.]+)(pt|in|cm|mm)/i);
        if (wMatch) {
            const val = parseFloat(wMatch[1]);
            const unit = wMatch[2].toLowerCase();
            if (unit === 'pt') length += val / 6;
            else if (unit === 'in') length += val * 12;
            else if (unit === 'cm') length += val * 4.7;
            else if (unit === 'mm') length += val * 0.47;
        } else {
            shapeCountFallback++;
        }
    });
    
    // Math usually has text inside, but add a small constant per equation
    const math = node.getElementsByTagName('m:oMath').length;
    const objects = node.getElementsByTagName('w:object').length;
    const pics = node.getElementsByTagName('w:pict').length;
    
    // If we have w:object or w:pict but no v:shape or wp:extent was found, use small fallback
    const unaccountedObjects = Math.max(0, objects + pics - shapes.length - extents.length);
    
    length += shapeCountFallback * 10;
    length += unaccountedObjects * 10;
    length += math * 4;
  }
  return Math.ceil(length);
}

function setParagraphIndent(pNode: Element, xmlDoc: Document, left: number, hanging: number) {
  if (pNode.nodeName.replace(/^.*:/, '') !== 'p') return;
  let pPr = Array.from(pNode.childNodes).find(n => n.nodeName.replace(/^.*:/, '') === 'pPr') as Element;
  if (!pPr) {
    pPr = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:pPr');
    pNode.insertBefore(pPr, pNode.firstChild);
  }
  let ind = Array.from(pPr.childNodes).find(n => n.nodeName.replace(/^.*:/, '') === 'ind') as Element;
  if (!ind) {
    ind = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:ind');
    pPr.appendChild(ind);
  }
  ind.setAttribute('w:left', left.toString());
  if (hanging > 0) {
    ind.setAttribute('w:hanging', hanging.toString());
    ind.removeAttribute('w:firstLine');
  } else {
    ind.removeAttribute('w:hanging');
    ind.removeAttribute('w:firstLine');
  }
}

function applyJustify(pNode: Element, xmlDoc: Document) {
  if (pNode.nodeName.replace(/^.*:/, '') !== 'p') return;
  let pPr = Array.from(pNode.childNodes).find(n => n.nodeName.replace(/^.*:/, '') === 'pPr') as Element;
  if (!pPr) {
    pPr = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:pPr');
    pNode.insertBefore(pPr, pNode.firstChild);
  }
  let jc = Array.from(pPr.childNodes).find(n => n.nodeName.replace(/^.*:/, '') === 'jc') as Element;
  if (!jc) {
    jc = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:jc');
    pPr.appendChild(jc);
  }
  jc.setAttribute('w:val', 'both');
}

function applyTabsToPPr(pNode: Element, xmlDoc: Document, preset: '4cols' | '2cols' | 'default' = 'default') {
  let pPr = Array.from(pNode.childNodes).find(n => n.nodeName.replace(/^.*:/,'') === 'pPr') as Element | undefined;
  if (!pPr) {
      pPr = xmlDoc.createElementNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'w:pPr');
      pNode.insertBefore(pPr, pNode.firstChild);
  }
  
  const existingTabs = Array.from(pPr.getElementsByTagName('*')).filter(n => n.nodeName.replace(/^.*:/, '') === 'tabs');
  existingTabs.forEach(t => t.parentNode?.removeChild(t));

  let tabsStr = '';
  // Assuming page margins = 340 twips each side, total content width = 11227 twips.
  // Left indent for options = 850 twips. Useful width = 10377.
  // 4 cols width = 2594. Tabs = 850+2594=3444, 3444+2594=6038, 6038+2594=8632
  // 2 cols width = 5188. Tab = 850+5188=6038
  if (preset === '4cols') {
      tabsStr = `<w:tabs><w:tab w:val="left" w:pos="3444"/><w:tab w:val="left" w:pos="6038"/><w:tab w:val="left" w:pos="8632"/></w:tabs>`;
  } else if (preset === '2cols') {
      tabsStr = `<w:tabs><w:tab w:val="left" w:pos="6038"/></w:tabs>`;
  }
  
  if (tabsStr) {
      const tabsNode = createNodesFromXMLString(xmlDoc, tabsStr)[0];
      pPr.appendChild(tabsNode);
  }
  
  const pPrOrder = [
    'pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl', 'numPr',
    'suppressLineNumbers', 'pBdr', 'shd', 'tabs', 'suppressAutoHyphens', 'kinsoku', 'wordWrap',
    'overflowPunct', 'topLinePunct', 'autoSpaceDE', 'autoSpaceDN', 'bidi', 'adjustRightInd',
    'snapToGrid', 'spacing', 'ind', 'contextualSpacing', 'mirrorIndents', 'suppressOverlap',
    'jc', 'textDirection', 'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId',
    'cnfStyle', 'rPr', 'sectPr', 'pPrChange'
  ];

  const children = Array.from(pPr.childNodes);
  children.sort((a, b) => {
      const nameA = a.nodeName.replace(/^.*:/, '');
      const nameB = b.nodeName.replace(/^.*:/, '');
      let idxA = pPrOrder.indexOf(nameA);
      let idxB = pPrOrder.indexOf(nameB);
      if (idxA === -1) idxA = 999;
      if (idxB === -1) idxB = 999;
      return idxA - idxB;
  });
  
  children.forEach(c => pPr!.appendChild(c));
}

function appendTabToParagraph(pNode: Element, xmlDoc: Document) {
    if (pNode.nodeName.replace(/^.*:/, '') === 'p') {
        const tabR = createNodesFromXMLString(xmlDoc, `<w:r><w:tab/></w:r>`)[0];
        pNode.appendChild(tabR);
    }
}

function mergeOptionsWithTabs(optNodesArr: Element[][], xmlDoc: Document, preset: '4cols' | '2cols' | 'default' = 'default'): Element[] {
  const newP = createNodesFromXMLString(xmlDoc, `<w:p></w:p>`)[0] as Element;
  
  const firstP = optNodesArr[0].find(n => n.nodeName.replace(/^.*:/,'') === 'p') as Element | undefined;
  if (firstP) {
      const originalPPr = Array.from(firstP.childNodes).find(n => n.nodeName.replace(/^.*:/,'') === 'pPr') as Element | undefined;
      if (originalPPr) {
          const pPrClone = originalPPr.cloneNode(true) as Element;
          newP.appendChild(pPrClone);
      }
  }

  applyTabsToPPr(newP, xmlDoc, preset);

  optNodesArr.forEach((optNodes, idx) => {
      if (idx > 0) {
          const tabNode = createNodesFromXMLString(xmlDoc, `<w:r><w:tab/></w:r>`)[0];
          newP.appendChild(tabNode);
      }
      
      optNodes.forEach(node => {
          if (node.nodeName.replace(/^.*:/, '') === 'p') {
              Array.from(node.childNodes).forEach(child => {
                  if (child.nodeName.replace(/^.*:/, '') !== 'pPr') {
                      newP.appendChild(child.cloneNode(true));
                  }
              });
          } else {
              newP.appendChild(node.cloneNode(true));
          }
      });
  });
  
  return [newP];
}

export async function generateTests(fileBuffer: ArrayBuffer, numTests: number, onProgress: (progress: number) => void) {
  const resultZip = new JSZip();
  const allAnswersText = [];

  for (let i = 0; i < numTests; i++) {
    const testCode = String(100 + i + 1);
    
    // Parse fresh for each test to keep DOM operations independent
    const zip = await JSZip.loadAsync(fileBuffer);
    const xmlBuffer = await zip.file('word/document.xml')?.async('text');
    if (!xmlBuffer) throw new Error("File word không hợp lệ (không tìm thấy document.xml)");

    const xmlDoc = new DOMParser().parseFromString(xmlBuffer, 'application/xml');
    
    // Update all page margins to 0.6 cm (approx 340 twips)
    Array.from(xmlDoc.getElementsByTagName('w:pgMar')).forEach(pgMar => {
      pgMar.setAttribute('w:top', '340');
      pgMar.setAttribute('w:bottom', '340');
      pgMar.setAttribute('w:left', '340');
      pgMar.setAttribute('w:right', '340');
    });
    // Set A4 Portrait size
    Array.from(xmlDoc.getElementsByTagName('w:pgSz')).forEach(pgSz => {
      pgSz.setAttribute('w:w', '11906');
      pgSz.setAttribute('w:h', '16838');
    });

    const parseRes = parseQuestions(xmlDoc);
    const { questions, preQuestionNodes, postQuestionNodes, body } = parseRes;

    while (body.firstChild) {
      body.removeChild(body.firstChild);
    }

    preQuestionNodes.forEach((n) => body.appendChild(n));
    
    // Yêu cầu: "Sát dòng trên câu 1 bạn điền thêm 2 dòng"
    const headerNodesXml = `
      <w:p>
        <w:pPr>
          <w:jc w:val="center"/>
        </w:pPr>
        <w:r>
          <w:t>------------------------------------------------------------------------------------------------------------------</w:t>
        </w:r>
      </w:p>
      <w:p>
        <w:pPr>
          <w:jc w:val="left"/>
        </w:pPr>
        <w:r>
          <w:rPr>
            <w:b/>
          </w:rPr>
          <w:t>Mã đề ${testCode}</w:t>
        </w:r>
      </w:p>
    `;
    const headerNodes = createNodesFromXMLString(xmlDoc, headerNodesXml);
    headerNodes.forEach((n) => body.appendChild(n));

    const shuffledQuestions = [...questions].sort(() => Math.random() - 0.5);
    const answerKey: { qIndex: number; answer: string; origIndex: number }[] = [];

    shuffledQuestions.forEach((q, qIndex) => {
      // 1. Rewrite and append header
      replacePrefix(q.header[0], /^\s*[cC][aâ]u\s+\d+[\.\:]?\s*/, ``, { bold: true, color: '0000FF', autoNum: true, qIndex: qIndex }, xmlDoc);
      q.header.forEach((n: Element, i: number) => {
          applyJustify(n, xmlDoc); // Justify text for questions
          body.appendChild(n);
      });

      // 2. Shuffle options
      const optLabels = ['A', 'B', 'C', 'D'];
      const currentOpts = [];
      if (q.A.length > 0) currentOpts.push('A');
      if (q.B.length > 0) currentOpts.push('B');
      if (q.C.length > 0) currentOpts.push('C');
      if (q.D.length > 0) currentOpts.push('D');

      const shuffledOpts = [...currentOpts].sort(() => Math.random() - 0.5);

      shuffledOpts.forEach((oldLabel, j) => {
        const newLabel = optLabels[j];
        let isCorrect = (oldLabel === q.origCorrect);
        if (isCorrect) {
          answerKey.push({ qIndex: qIndex + 1, answer: newLabel, origIndex: q.origIndex + 1 });
        }
        
        // Strip any existing tabs from options to prevent column alignment issues
        q[oldLabel].forEach((node: Element) => {
            if (node.getElementsByTagName) {
                Array.from(node.getElementsByTagName('w:tab')).forEach(t => t.parentNode?.removeChild(t));
                Array.from(node.getElementsByTagName('tab')).forEach(t => t.parentNode?.removeChild(t));
            }
            if (node.nodeName.replace(/^.*:/, '') === 'p') {
                setParagraphIndent(node, xmlDoc, 850, 0); // Indent options 1.5cm
            }
        });

        replacePrefix(q[oldLabel][0], /^\s*[A-D][\.\:]?\s*/i, `${newLabel}. `, { bold: true, color: isCorrect ? 'FF0000' : '0000FF', underline: isCorrect }, xmlDoc);
      });

      const maxLen = Math.max(
        ...shuffledOpts.map((label) => getOptionLength(q[label]))
      );

      let columns = 1;
      if (shuffledOpts.length === 4) {
          if (maxLen <= 25) columns = 4;
          else if (maxLen <= 55) columns = 2;
      } else if (shuffledOpts.length === 2) {
          if (maxLen <= 55) columns = 2;
      }

      if (columns === 4) {
          const merged = mergeOptionsWithTabs([
              q[shuffledOpts[0]], q[shuffledOpts[1]], q[shuffledOpts[2]], q[shuffledOpts[3]]
          ], xmlDoc, '4cols');
          merged.forEach(n => body.appendChild(n));
      } else if (columns === 2) {
          if (shuffledOpts.length === 4) {
              const merged1 = mergeOptionsWithTabs([q[shuffledOpts[0]], q[shuffledOpts[1]]], xmlDoc, '2cols');
              const merged2 = mergeOptionsWithTabs([q[shuffledOpts[2]], q[shuffledOpts[3]]], xmlDoc, '2cols');
              merged1.forEach(n => body.appendChild(n));
              merged2.forEach(n => body.appendChild(n));
          } else if (shuffledOpts.length === 2) {
              const merged = mergeOptionsWithTabs([
                  q[shuffledOpts[0]], q[shuffledOpts[1]]
              ], xmlDoc, '2cols');
              merged.forEach(n => body.appendChild(n));
          } else {
              shuffledOpts.forEach((oldLabel) => {
                const optNodes = q[oldLabel];
                optNodes.forEach((n: Element, idx: number) => {
                    if (n.nodeName.replace(/^.*:/, '') === 'p') {
                        // Apply default single col setting (maybe no tabs needed, but let's just leave it empty)
                        applyTabsToPPr(n, xmlDoc, 'default');
                    }
                    body.appendChild(n);
                });
              });
          }
      } else {
          shuffledOpts.forEach((oldLabel) => {
            const optNodes = q[oldLabel];
            optNodes.forEach((n: Element, idx: number) => {
                if (n.nodeName.replace(/^.*:/, '') === 'p') {
                    applyTabsToPPr(n, xmlDoc, 'default');
                }
                body.appendChild(n);
            });
          });
      }
    });

    const endOfTestXml = `
      <w:p>
        <w:pPr>
          <w:jc w:val="center"/>
        </w:pPr>
        <w:r>
          <w:t>---------------------------------Hết---------------------------------</w:t>
        </w:r>
      </w:p>
    `;
    const endNodes = createNodesFromXMLString(xmlDoc, endOfTestXml);
    endNodes.forEach((n) => body.appendChild(n));

    // 3. Append Answer Key for this test
    const sortedKeys = answerKey.sort((a, b) => a.qIndex - b.qIndex);
    
    let answerContentXml = `
      <w:p>
        <w:pPr>
          <w:jc w:val="center"/>
        </w:pPr>
        <w:r>
          <w:rPr>
            <w:b/>
            <w:sz w:val="32"/>
          </w:rPr>
          <w:t>--- ĐÁP ÁN MÃ ĐỀ ${testCode} ---</w:t>
        </w:r>
      </w:p>
    `;

    answerContentXml += `
      <w:tbl>
        <w:tblPr>
          <w:jc w:val="center"/>
          <w:tblW w:w="0" w:type="auto"/>
          <w:tblBorders>
            <w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>
            <w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>
            <w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>
            <w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>
            <w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/>
            <w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>
          </w:tblBorders>
        </w:tblPr>
    `;

    for (let j = 0; j < sortedKeys.length; j += 10) {
      const chunk = sortedKeys.slice(j, j + 10);
      answerContentXml += `<w:tr>`;
      for (const k of chunk) {
          answerContentXml += `
            <w:tc>
              <w:tcPr>
                <w:tcW w:w="0" w:type="auto"/>
                <w:vAlign w:val="center"/>
              </w:tcPr>
              <w:p>
                <w:pPr>
                  <w:jc w:val="center"/>
                </w:pPr>
                <w:r>
                  <w:t>${k.qIndex}. ${k.answer}</w:t>
                </w:r>
              </w:p>
            </w:tc>
          `;
      }
      // Fill remaining cells if chunk length < 10
      for (let i = chunk.length; i < 10; i++) {
          answerContentXml += `
            <w:tc>
              <w:tcPr>
                <w:tcW w:w="0" w:type="auto"/>
              </w:tcPr>
              <w:p/>
            </w:tc>
          `;
      }
      answerContentXml += `</w:tr>`;
    }
    answerContentXml += `</w:tbl>`;

    const answerNodes = createNodesFromXMLString(xmlDoc, answerContentXml);
    answerNodes.forEach((n) => body.appendChild(n));

    // 4. Append post nodes (sectPr must be last)
    postQuestionNodes.forEach((n) => body.appendChild(n));

    // 5. Build full answer text for the consolidated file
    let ansTxt = `MÃ ĐỀ: ${testCode}\n`;
    for (let j = 0; j < sortedKeys.length; j += 10) {
      ansTxt += sortedKeys.slice(j, j + 10).map((k) => `${k.qIndex}. ${k.answer}`).join("   ") + "\n";
    }
    allAnswersText.push(ansTxt);

    // 6. Serialize and save to zip
    const serializer = new XMLSerializer();
    const newXml = serializer.serializeToString(xmlDoc);
    zip.file('word/document.xml', newXml);

    const docxBuffer = await zip.generateAsync({ type: 'blob' });
    resultZip.file(`Ma_De_${testCode}.docx`, docxBuffer);
    
    onProgress(((i + 1) / numTests) * 100);
  }

  // Add consolidated answer key
  resultZip.file("Bang_Dap_An.txt", allAnswersText.join("\n\n------------------------------\n\n"));

  const finalBlob = await resultZip.generateAsync({ type: 'blob' });
  saveAs(finalBlob, 'Bo_De_Tron_Trac_Nghiem.zip');
}

