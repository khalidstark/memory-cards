// UI strings. Card text lives in data/*.json — this is only the chrome.
import { LINKEDIN_URL } from './config.js';

export const STRINGS = {
  en: {
    dir: 'ltr',
    langName: 'العربية',
    tagline: 'A small thank-you from the Connects AI Berlin workshop.',
    intro:
      'Before I left Berlin I made a card for the people I met here. Each one is opened by its own QR code — if I gave you one, scan it and yours will be waiting.',
    sampleLabel: 'What a card looks like',
    sampleNote: 'Every card carries a message written for one person, and a back side only they get to read.',
    askTitle: 'Let’s put your name on it',
    askBody: 'Tell me your name and I’ll finish the card for you.',
    front: 'Front',
    back: 'Back',
    downloadPdf: 'Download PDF',
    savePhoto: 'Save to Photos',
    saveImage: 'Download image',
    working: 'Preparing…',
    linkedin: 'Connect with me on LinkedIn',
    linkedinHref: LINKEDIN_URL,
    notFoundTitle: 'This card isn’t assigned yet',
    notFoundBody:
      'That link doesn’t match anyone on my list — the code may have been mistyped, or it’s a screenshot of someone else’s code. Every card here belongs to a QR code I handed out personally.',
    yourName: 'Your name',
    namePlaceholder: 'e.g. Besho',
    generate: 'Show my card',
    startOver: 'Change details',
    nameRequired: 'Please enter your name first.',
    loadError: 'Something didn’t load. Please refresh the page.',
    backHome: 'Home',
  },
  ar: {
    dir: 'rtl',
    langName: 'English',
    tagline: 'كلمة شكر صغيرة من ورشة كونيكتس إيه آي في برلين.',
    intro:
      'قبل ما أسيب برلين عملت كارت للناس اللي قابلتهم هنا. كل كارت بيتفتح بكود QR خاص بيه — لو إديتك واحد، امسحه وهتلاقي الكارت بتاعك مستنيك.',
    sampleLabel: 'الكارت شكله إيه',
    sampleNote: 'كل كارت فيه كلام متكتب لشخص واحد بس، وضهر محدش غيره هيقراه.',
    askTitle: 'يلا نكتب اسمك عليه',
    askBody: 'قوللي اسمك وأنا هكمّل الكارت.',
    front: 'الوجه',
    back: 'الظهر',
    downloadPdf: 'تحميل PDF',
    savePhoto: 'حفظ في الصور',
    saveImage: 'تحميل الصورة',
    working: 'جاري التجهيز…',
    linkedin: 'تواصل معي على لينكدإن',
    linkedinHref: LINKEDIN_URL,
    notFoundTitle: 'الكارت ده لسه مش متخصص لحد',
    notFoundBody:
      'اللينك ده مش موجود عندي في القائمة — يمكن الكود اتكتب غلط، أو ده سكرين شوت من كود حد تاني. كل كارت هنا ليه كود QR سلمته بإيدي.',
    yourName: 'اسمك',
    namePlaceholder: 'مثال: بيشو',
    generate: 'اعرض الكارت',
    startOver: 'تغيير البيانات',
    nameRequired: 'اكتب اسمك الأول من فضلك.',
    loadError: 'في حاجة ما اتحملتش. حدّث الصفحة من فضلك.',
    backHome: 'الرئيسية',
  },
};

const KEY = 'giu-card-lang';

export function getLang() {
  const fromUrl = new URLSearchParams(location.search).get('lang');
  if (fromUrl === 'en' || fromUrl === 'ar') return fromUrl;
  const stored = localStorage.getItem(KEY);
  if (stored === 'en' || stored === 'ar') return stored;
  return navigator.language?.startsWith('ar') ? 'ar' : 'en';
}

export function setLang(lang) {
  localStorage.setItem(KEY, lang);
  applyLang(lang);
}

export function applyLang(lang) {
  const t = STRINGS[lang];
  document.documentElement.lang = lang;
  document.documentElement.dir = t.dir;
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const value = t[el.dataset.i18n];
    if (value != null) el.textContent = value;
  }
  for (const el of document.querySelectorAll('[data-i18n-href]')) {
    const value = t[el.dataset.i18nHref];
    if (value != null) el.href = value;
  }
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) {
    const value = t[el.dataset.i18nPlaceholder];
    if (value != null) el.placeholder = value;
  }
}

/**
 * Wires the EN/AR button. `onChange` re-renders whatever the page is showing.
 */
export function mountLangToggle(button, onChange) {
  let lang = getLang();
  applyLang(lang);
  button.addEventListener('click', () => {
    lang = lang === 'en' ? 'ar' : 'en';
    setLang(lang);
    onChange?.(lang);
  });
  return () => lang;
}

/** Picks the right side of a `{ en, ar }` pair, falling back to the other. */
export function pick(value, lang) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return value[lang] || value.en || value.ar || '';
}
