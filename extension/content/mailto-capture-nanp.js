(() => {
  const KEY = Symbol.for('cosmic-gemini.mailto-capture.nanp');
  if (globalThis[KEY]) return;
  // Derived from the official NANPA NPA Database dated 09/21/2026.
  // https://reports.nanpa.com/public/npa_report.csv
  const groups = [
    ['Alabama, United States', '205,251,256,334,483,659,938'],
    ['Alaska, United States', '907'],
    ['Alberta, Canada', '368,403,587,780,825'],
    ['American Samoa', '684'],
    ['Anguilla', '264'],
    ['Antigua and Barbuda', '268'],
    ['Arizona, United States', '480,520,602,623,928'],
    ['Arkansas, United States', '327,479,501,870'],
    ['Barbados', '246'],
    ['Bermuda', '441'],
    ['British Columbia, Canada', '236,250,257,604,672,778'],
    ['British Virgin Islands', '284'],
    ['California, United States', '209,213,279,310,323,341,350,357,369,408,415,424,442,510,530,559,562,619,626,628,650,657,661,669,707,714,738,747,760,805,818,820,831,837,840,858,909,916,925,949,951'],
    ['Canadian Non-Geographic Services, Canada', '622'],
    ['Canadian Non-Geographic Tariffed Services, Canada', '600'],
    ['Cayman Islands', '345'],
    ['Colorado, United States', '303,719,720,748,970,983'],
    ['Connecticut, United States', '203,475,860,959'],
    ['Delaware, United States', '302'],
    ['District of Columbia, United States', '202,771'],
    ['Dominica', '767'],
    ['Dominican Republic', '809,829,849'],
    ['Florida, United States', '239,305,321,324,352,386,407,448,561,645,656,689,727,728,754,772,786,813,850,863,904,941,954'],
    ['Georgia, United States', '229,404,470,478,678,706,762,770,912,943'],
    ['Grenada', '473'],
    ['Guam', '671'],
    ['Hawaii, United States', '808'],
    ['Idaho, United States', '208,986'],
    ['Illinois, United States', '217,224,309,312,331,447,464,618,630,708,730,773,779,815,847,861,872'],
    ['Indiana, United States', '219,260,317,463,574,765,812,930'],
    ['Interexchange Carrier Services, North American Numbering Plan', '700'],
    ['Iowa, United States', '319,515,563,641,712'],
    ['Jamaica', '658,876'],
    ['Kansas, United States', '316,620,785,913'],
    ['Kentucky, United States', '270,364,502,606,859'],
    ['Louisiana, United States', '225,318,337,457,504,985'],
    ['Maine, United States', '207'],
    ['Manitoba, Canada', '204,431,584'],
    ['Maryland, United States', '227,240,301,410,443,667'],
    ['Massachusetts, United States', '339,351,413,508,617,774,781,857,978'],
    ['Michigan, United States', '231,248,269,313,517,586,616,679,734,810,906,947,989'],
    ['Minnesota, United States', '218,320,507,612,651,763,924,952'],
    ['Mississippi, United States', '228,471,601,662,769'],
    ['Missouri, United States', '235,314,417,557,573,636,660,816,975'],
    ['Montana, United States', '406'],
    ['Montserrat', '664'],
    ['Nebraska, United States', '308,402,531'],
    ['Nevada, United States', '702,725,775'],
    ['New Brunswick, Canada', '428,506'],
    ['New Hampshire, United States', '603'],
    ['New Jersey, United States', '201,551,609,640,732,848,856,862,908,973'],
    ['New Mexico, United States', '505,575'],
    ['New York, United States', '212,315,329,332,347,363,465,516,518,585,607,624,631,646,680,716,718,838,845,914,917,929,934'],
    ['Newfoundland and Labrador, Canada', '709,879'],
    ['Non-Geographic Services, Canada', '633'],
    ['Non-Geographic Services, United States', '500,521,522,523,524,525,526,527,528,529,532,533,538,542,544,566,577,588'],
    ['North Carolina, United States', '252,336,472,704,743,828,910,919,980,984'],
    ['North Dakota, United States', '701'],
    ['Northern Mariana Islands', '670'],
    ['Northwest Territories, Yukon, and Nunavut, Canada', '867'],
    ['Nova Scotia and Prince Edward Island, Canada', '782,902'],
    ['Ohio, United States', '216,220,234,283,326,330,380,419,436,440,513,567,614,740,937'],
    ['Oklahoma, United States', '405,539,572,580,918'],
    ['Ontario, Canada', '226,249,289,343,365,382,416,437,519,548,613,647,683,705,742,753,807,905,942'],
    ['Oregon, United States', '458,503,541,971'],
    ['Pennsylvania, United States', '215,223,267,272,412,445,484,570,582,610,717,724,814,835,878'],
    ['Premium Services, North American Numbering Plan', '900'],
    ['Puerto Rico, United States', '787,939'],
    ['Quebec, Canada', '263,354,367,418,438,450,468,514,579,581,819,873'],
    ['Rhode Island, United States', '401'],
    ['Saint Kitts and Nevis', '869'],
    ['Saint Lucia', '758'],
    ['Saint Vincent and the Grenadines', '784'],
    ['Saskatchewan, Canada', '306,474,639'],
    ['Sint Maarten', '721'],
    ['South Carolina, United States', '803,821,839,843,854,864'],
    ['South Dakota, United States', '605'],
    ['Tennessee, United States', '423,615,629,729,731,865,901,931'],
    ['Texas, United States', '210,214,254,281,325,346,361,409,430,432,469,512,621,682,713,726,737,806,817,830,832,903,915,936,940,945,956,972,979'],
    ['The Bahamas', '242'],
    ['Toll-Free, North American Numbering Plan', '800,833,844,855,866,877,888'],
    ['Trinidad and Tobago', '868'],
    ['Turks and Caicos Islands', '649'],
    ['U.S. Government', '710'],
    ['U.S. Virgin Islands', '340'],
    ['Utah, United States', '385,435,801'],
    ['Vermont, United States', '802'],
    ['Virginia, United States', '276,434,540,571,686,703,757,804,826,948'],
    ['Washington, United States', '206,253,360,425,509,564'],
    ['West Virginia, United States', '304,681'],
    ['Wisconsin, United States', '262,274,353,414,534,608,715,920'],
    ['Wyoming, United States', '307'],
  ];
  const locations = new Map();
  for (const [location, codes] of groups) for (const code of codes.split(',')) locations.set(code, location);

  function areaCode(value) {
    const raw = String(value || '').trim();
    const primary = raw.split(';', 1)[0];
    if (primary.startsWith('+') && !primary.startsWith('+1')) return '';
    let digits = primary.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
    return digits.length === 10 ? digits.slice(0, 3) : '';
  }

  function lookup(value) {
    const code = areaCode(value);
    if (!code) return '';
    return locations.get(code) || 'North American Numbering Plan (area code not identified)';
  }

  Object.defineProperty(globalThis, KEY, {
    value: Object.freeze({ lookup }),
    configurable: true
  });
})();
