import { DOCUMENT_PREVIEW_PATH, isLocalDocumentId } from '../../core/document-preview/document-preview.js';
const params = new URLSearchParams(location.hash.slice(1));
location.replace(chrome.runtime.getURL(DOCUMENT_PREVIEW_PATH) + (isLocalDocumentId(params.get('id')) ? '#' + params : ''));
