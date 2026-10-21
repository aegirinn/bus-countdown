import { createContext, useContext } from 'react';

// All interface text lives here. Stop names and destinations come from Strætó and stay as they are.
export const LANGS = [
  { code: 'is', label: 'IS', name: 'Íslenska' },
  { code: 'en', label: 'EN', name: 'English' },
];

export const STRINGS = {
  is: {
    brand: 'Næsti vagn',
    sampleData: 'prufugögn',
    liveTag: 'rauntími',
    whichStop: 'Á hvaða stoppistöð ertu?',
    placeholder: 't.d. Mjódd, Ártún',
    nearMe: 'Nálægt mér',
    nearMeTitle: 'Finna stoppistöðvar nálægt mér',
    noGeo: 'Vafrinn þinn býður ekki upp á staðsetningu.',
    geoFailed: 'Ekki tókst að finna staðsetninguna þína.',
    noMatch: (q) => `Engin stoppistöð passar við „${q}“.`,
    saved: 'Vistað',
    recent: 'Nýlega skoðað',
    clear: 'Hreinsa',
    save: 'Vista',
    back: 'Velja aðra stoppistöð',
    favAdd: 'Vista þessa stoppistöð og leið',
    favRemove: 'Fjarlægja úr vistuðu',
    bus: 'Leið',
    any: 'Allar',
    towards: 'Í átt',
    eitherWay: 'Báðar áttir',
    loading: 'Sæki tímatöflu…',
    noMore: (route) =>
      route ? `Engar fleiri ferðir með leið ${route} næsta sólarhringinn.` : 'Engar fleiri ferðir næsta sólarhringinn.',
    to: (h) => `→ ${h}`, // "til" would need the genitive form of each place name, so an arrow reads better
    platform: (p) => `Stæði ${p}`,
    live: (t) => `Rauntími · væntanlegur ${t}`,
    late: (n) => `${n} mín. seinn`,
    early: (n) => `${n} mín. á undan`,
    timetable: (t) => `Tímatafla · ${t}`,
    afterThat: 'Næstu ferðir',
    foot: 'Tímarnir eru úr tímatöflu Strætó og taka ekki mið af umferð eða seinkunum.',
    now: 'Núna',
    nowShort: 'núna',
    min: 'mín',
    hour: 'klst',
    language: 'Tungumál',
    bellOn: 'Hringja bjöllu þegar 5 mín eru í vagninn',
    bellOff: 'Hætta við bjöllu',
    bellArmed: 'Bjallan hringir þegar 5 mín eru í vagninn. Hafðu síðuna opna.',
    bellRang: 'Vagninn kemur eftir um 5 mín.',
  },
  en: {
    brand: 'Next bus',
    sampleData: 'sample data',
    liveTag: 'live',
    whichStop: 'Which stop are you at?',
    placeholder: 'e.g. Mjódd, Ártún',
    nearMe: 'Near me',
    nearMeTitle: 'Find stops near me',
    noGeo: 'Your browser does not share location.',
    geoFailed: 'Could not get your location.',
    noMatch: (q) => `No stops match “${q}”.`,
    saved: 'Saved',
    recent: 'Recent',
    clear: 'Clear',
    save: 'Save',
    back: 'Choose another stop',
    favAdd: 'Save this stop and route',
    favRemove: 'Remove from saved',
    bus: 'Bus',
    any: 'Any',
    towards: 'Towards',
    eitherWay: 'Either way',
    loading: 'Loading timetable…',
    noMore: (route) => `No more buses ${route ? `on route ${route} ` : ''}in the next 24 hours.`,
    to: (h) => `to ${h}`,
    platform: (p) => `Platform ${p}`,
    live: (t) => `Live · expected ${t}`,
    late: (n) => `${n} min late`,
    early: (n) => `${n} min early`,
    timetable: (t) => `Timetable · ${t}`,
    afterThat: 'After that',
    foot: 'Times are from Strætó’s published timetable, so they don’t account for traffic or delays.',
    now: 'Now',
    nowShort: 'now',
    min: 'min',
    hour: 'h',
    language: 'Language',
    bellOn: 'Ring a bell when the bus is 5 min away',
    bellOff: 'Cancel the bell',
    bellArmed: 'The bell will ring when the bus is 5 min away. Keep this page open.',
    bellRang: 'The bus is about 5 min away.',
  },
};

const LANG_KEY = 'bus-countdown:lang';

export function loadLang() {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v && STRINGS[v]) return v;
  } catch {
    /* storage blocked */
  }
  return 'is'; // Icelandic first
}

export function saveLang(code) {
  try {
    localStorage.setItem(LANG_KEY, code);
  } catch {
    /* storage blocked */
  }
}

export const LangContext = createContext(STRINGS.is);
export const useT = () => useContext(LangContext);
