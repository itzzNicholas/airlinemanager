'use strict';
// ---------------------------------------------------------------------------
// Dati statici: aeroporti e catalogo aerei.
// ---------------------------------------------------------------------------

// [IATA, città, paese, continente, lat, lon, dimensione 1-10]
const A = [
  // Europa
  ['LHR','London','United Kingdom','EU',51.4700,-0.4543,10],['CDG','Paris','France','EU',49.0097,2.5479,9],
  ['FRA','Frankfurt','Germany','EU',50.0379,8.5622,9],['AMS','Amsterdam','Netherlands','EU',52.3105,4.7683,8],
  ['MAD','Madrid','Spain','EU',40.4936,-3.5668,8],['BCN','Barcelona','Spain','EU',41.2974,2.0833,7],
  ['FCO','Rome','Italy','EU',41.8003,12.2389,8],['MXP','Milan','Italy','EU',45.6306,8.7281,7],
  ['VCE','Venice','Italy','EU',45.5053,12.3519,5],['NAP','Naples','Italy','EU',40.8860,14.2908,4],
  ['CTA','Catania','Italy','EU',37.4668,15.0664,4],['MUC','Munich','Germany','EU',48.3537,11.7750,8],
  ['ZRH','Zurich','Switzerland','EU',47.4647,8.5492,6],['VIE','Vienna','Austria','EU',48.1103,16.5697,6],
  ['BRU','Brussels','Belgium','EU',50.9014,4.4844,5],['CPH','Copenhagen','Denmark','EU',55.6180,12.6560,6],
  ['ARN','Stockholm','Sweden','EU',59.6519,17.9186,5],['OSL','Oslo','Norway','EU',60.1939,11.1004,5],
  ['HEL','Helsinki','Finland','EU',60.3172,24.9633,5],['DUB','Dublin','Ireland','EU',53.4213,-6.2701,5],
  ['EDI','Edinburgh','United Kingdom','EU',55.9500,-3.3725,4],['LIS','Lisbon','Portugal','EU',38.7742,-9.1342,6],
  ['ATH','Athens','Greece','EU',37.9364,23.9445,5],['WAW','Warsaw','Poland','EU',52.1657,20.9671,5],
  ['PRG','Prague','Czechia','EU',50.1008,14.2600,5],['BUD','Budapest','Hungary','EU',47.4369,19.2556,4],
  ['KEF','Reykjavik','Iceland','EU',63.9850,-22.6056,3],['IST','Istanbul','Turkey','EU',41.2753,28.7519,9],
  ['SVO','Moscow','Russia','EU',55.9726,37.4146,9],['LED','Saint Petersburg','Russia','EU',59.8003,30.2625,6],
  ['KZN','Kazan','Russia','EU',55.6062,49.2787,4],
  // Asia
  ['SVX','Yekaterinburg','Russia','AS',56.7430,60.8027,4],['OVB','Novosibirsk','Russia','AS',55.0126,82.6507,4],
  ['VVO','Vladivostok','Russia','AS',43.3990,132.1480,3],['TAS','Tashkent','Uzbekistan','AS',41.2579,69.2811,4],
  ['ALA','Almaty','Kazakhstan','AS',43.3521,77.0405,4],['DEL','Delhi','India','AS',28.5562,77.1000,9],
  ['BOM','Mumbai','India','AS',19.0896,72.8656,8],['BLR','Bengaluru','India','AS',13.1986,77.7066,6],
  ['KHI','Karachi','Pakistan','AS',24.9065,67.1608,5],['CMB','Colombo','Sri Lanka','AS',7.1808,79.8841,3],
  ['BKK','Bangkok','Thailand','AS',13.6900,100.7501,8],['SIN','Singapore','Singapore','AS',1.3644,103.9915,9],
  ['KUL','Kuala Lumpur','Malaysia','AS',2.7456,101.7099,7],['CGK','Jakarta','Indonesia','AS',-6.1256,106.6559,7],
  ['MNL','Manila','Philippines','AS',14.5086,121.0194,6],['SGN','Ho Chi Minh City','Vietnam','AS',10.8188,106.6519,6],
  ['HAN','Hanoi','Vietnam','AS',21.2212,105.8072,5],['HKG','Hong Kong','China','AS',22.3080,113.9185,9],
  ['CAN','Guangzhou','China','AS',23.3924,113.2988,8],['PVG','Shanghai','China','AS',31.1443,121.8083,10],
  ['PEK','Beijing','China','AS',40.0801,116.5846,10],['TPE','Taipei','Taiwan','AS',25.0797,121.2342,7],
  ['ICN','Seoul','South Korea','AS',37.4602,126.4407,9],['HND','Tokyo','Japan','AS',35.5494,139.7798,10],
  ['KIX','Osaka','Japan','AS',34.4347,135.2440,7],
  // Medio Oriente
  ['DXB','Dubai','UAE','AS',25.2532,55.3657,10],['DOH','Doha','Qatar','AS',25.2731,51.6081,8],
  ['AUH','Abu Dhabi','UAE','AS',24.4330,54.6511,6],['RUH','Riyadh','Saudi Arabia','AS',24.9576,46.6988,6],
  ['JED','Jeddah','Saudi Arabia','AS',21.6796,39.1565,6],['TLV','Tel Aviv','Israel','AS',32.0114,34.8867,5],
  // Africa
  ['CAI','Cairo','Egypt','AF',30.1219,31.4056,7],['CMN','Casablanca','Morocco','AF',33.3675,-7.5899,4],
  ['LOS','Lagos','Nigeria','AF',6.5774,3.3212,5],['ADD','Addis Ababa','Ethiopia','AF',8.9779,38.7993,5],
  ['NBO','Nairobi','Kenya','AF',-1.3192,36.9278,5],['JNB','Johannesburg','South Africa','AF',-26.1392,28.2460,7],
  ['CPT','Cape Town','South Africa','AF',-33.9715,18.6021,5],
  // Oceania
  ['SYD','Sydney','Australia','OC',-33.9399,151.1753,8],['MEL','Melbourne','Australia','OC',-37.6690,144.8410,7],
  ['BNE','Brisbane','Australia','OC',-27.3842,153.1175,5],['PER','Perth','Australia','OC',-31.9403,115.9669,4],
  ['AKL','Auckland','New Zealand','OC',-37.0082,174.7850,5],
  // Nord America
  ['JFK','New York','USA','NA',40.6413,-73.7781,10],['LAX','Los Angeles','USA','NA',33.9416,-118.4085,10],
  ['ORD','Chicago','USA','NA',41.9742,-87.9073,9],['ATL','Atlanta','USA','NA',33.6407,-84.4277,9],
  ['DFW','Dallas','USA','NA',32.8998,-97.0403,8],['SFO','San Francisco','USA','NA',37.6213,-122.3790,8],
  ['MIA','Miami','USA','NA',25.7959,-80.2870,7],['SEA','Seattle','USA','NA',47.4502,-122.3088,6],
  ['BOS','Boston','USA','NA',42.3656,-71.0096,6],['DEN','Denver','USA','NA',39.8561,-104.6737,7],
  ['LAS','Las Vegas','USA','NA',36.0840,-115.1537,6],['HNL','Honolulu','USA','NA',21.3187,-157.9225,4],
  ['ANC','Anchorage','USA','NA',61.1743,-149.9983,3],['YYZ','Toronto','Canada','NA',43.6777,-79.6248,7],
  ['YVR','Vancouver','Canada','NA',49.1967,-123.1815,6],['YUL','Montreal','Canada','NA',45.4706,-73.7408,5],
  ['MEX','Mexico City','Mexico','NA',19.4361,-99.0719,8],['CUN','Cancun','Mexico','NA',21.0365,-86.8770,5],
  ['PTY','Panama City','Panama','NA',9.0714,-79.3835,4],
  // Sud America
  ['GRU','Sao Paulo','Brazil','SA',-23.4356,-46.4731,8],['GIG','Rio de Janeiro','Brazil','SA',-22.8100,-43.2506,5],
  ['EZE','Buenos Aires','Argentina','SA',-34.8222,-58.5358,6],['BOG','Bogota','Colombia','SA',4.7016,-74.1469,6],
  ['SCL','Santiago','Chile','SA',-33.3930,-70.7858,6],['LIM','Lima','Peru','SA',-12.0219,-77.1143,5],
].map(([iata, city, country, cont, lat, lon, size]) => ({ iata, city, country, cont, lat, lon, size }));

// Catalogo aerei. price = prezzo di listino reale in M$ (viene scalato da PRICE_SCALE).
// grade: F, E-, E, E+, D-, D, D+, C-, C, C+, B-, B, B+, A-, A, A+
const GRADES = ['F','E-','E','E+','D-','D','D+','C-','C','C+','B-','B','B+','A-','A','A+'];
const PRICE_SCALE = 0.12;
// id, maker, name, wiki, grade, seats, rangeKm, speedKmh, burnKgH, priceM, year, extra
const M = [
  ['c172','Cessna','172 Skyhawk','Cessna_172','F',3,1200,226,35,0.4,1956],
  ['c208','Cessna','208B Grand Caravan EX','Cessna_208_Caravan','E-',12,1980,340,170,2.7,1984],
  ['pc12','Pilatus','PC-12 NGX','Pilatus_PC-12','E',9,3400,500,190,5.2,1994],
  ['kingair','Beechcraft','King Air 350','Beechcraft_Super_King_Air','E',11,3300,560,300,8.4,1990],
  ['dhc6','De Havilland Canada','DHC-6 Twin Otter','De_Havilland_Canada_DHC-6_Twin_Otter','E+',19,1400,337,330,7.0,1965],
  ['saab340','Saab','340B','Saab_340','D-',34,1700,467,600,12,1984],
  ['atr42','ATR','ATR 42-600','ATR_42','D',48,1326,556,650,20,2010],
  ['atr72','ATR','ATR 72-600','ATR_72','D+',70,1528,510,720,26,2011],
  ['q400','De Havilland Canada','Dash 8 Q400','De_Havilland_Canada_Dash_8','D+',78,2040,667,1000,33,2000],
  ['ssj100','Sukhoi','Superjet 100','Sukhoi_Superjet_100','C-',98,4578,828,1700,38,2011],
  ['crj900','Bombardier','CRJ900','Bombardier_CRJ700_series','C-',90,2876,830,1900,48,2003],
  ['e175','Embraer','E175','Embraer_E-Jet_family','C-',78,3700,830,1700,50,2005],
  ['md80','McDonnell Douglas','MD-82','McDonnell_Douglas_MD-80','C',150,4000,811,2900,38,1980],
  ['b733','Boeing','737-300','Boeing_737_Classic','C',140,4200,800,2600,34,1984],
  ['tu154','Tupolev','Tu-154M','Tupolev_Tu-154','C',164,3900,850,5500,40,1984],
  ['e195e2','Embraer','E195-E2','Embraer_E-Jet_E2_family','C',120,4800,833,1900,62,2019],
  ['a220','Airbus','A220-300','Airbus_A220','C+',145,6300,828,2000,82,2016],
  ['c919','COMAC','C919','Comac_C919','B-',168,5555,834,2300,99,2022],
  ['mc21','Irkut','MC-21-300','Irkut_MC-21','B-',211,6000,870,2300,90,2022],
  ['b738','Boeing','737-800','Boeing_737_Next_Generation','B-',189,5436,842,2500,106,1998],
  ['b38m','Boeing','737 MAX 8','Boeing_737_MAX','B-',178,6500,839,2300,121,2017],
  ['a320n','Airbus','A320neo','Airbus_A320neo_family','B-',180,6300,833,2200,110,2016],
  ['a321n','Airbus','A321neo','Airbus_A321','B',220,7400,833,2600,130,2017],
  ['b752','Boeing','757-200','Boeing_757','B',200,7250,850,3200,90,1983],
  ['b763','Boeing','767-300ER','Boeing_767','B',218,11070,851,5200,220,1986],
  ['il96','Ilyushin','Il-96-300','Ilyushin_Il-96','B+',300,11500,850,6500,120,1993],
  ['b788','Boeing','787-8 Dreamliner','Boeing_787_Dreamliner','B+',242,13600,903,5000,248,2011],
  ['a333','Airbus','A330-300','Airbus_A330','B+',277,11750,871,5800,264,1993],
  ['a339','Airbus','A330-900neo','Airbus_A330neo','B+',287,13300,903,5400,296,2018],
  ['conc','Aérospatiale/BAC','Concorde','Concorde','A-',100,7200,2158,20000,280,1976,{lux:2.6}],
  ['b789','Boeing','787-9 Dreamliner','Boeing_787_Dreamliner','A-',290,14140,903,5300,292,2014],
  ['a359','Airbus','A350-900','Airbus_A350','A-',325,15000,903,5800,317,2015],
  ['b77w','Boeing','777-300ER','Boeing_777','A',396,13650,905,7500,375,2004],
  ['a35k','Airbus','A350-1000','Airbus_A350','A',366,16700,903,6500,366,2018],
  ['b779','Boeing','777-9','Boeing_777X','A',426,13500,905,7000,442,2025],
  ['b748','Boeing','747-8 Intercontinental','Boeing_747-8','A',410,14320,920,10000,418,2012],
  ['a388','Airbus','A380-800','Airbus_A380','A+',555,15200,903,11500,445,2007],
].map(([id, maker, name, wiki, grade, seats, range, speed, burn, priceM, year, extra]) => {
  const gi = GRADES.indexOf(grade);
  const cls = ['F','E','D','C','B','A'].indexOf(grade[0]); // classe di brevetto 0..5
  const price = Math.round(priceM * 1e6 * PRICE_SCALE / 1000) * 1000;
  return Object.assign({ id, maker, name, wiki, grade, gi, cls, seats, range, speed, burn, price, year,
    minAirport: [1, 1, 2, 3, 4, 5][cls] + (grade === 'A+' ? 1 : 0), lux: 1,
    deliveryH: [6, 18, 48, 96, 168, 240][cls] + (gi > 13 ? 48 : 0) }, extra || {});
});

const byIata = Object.fromEntries(A.map((a) => [a.iata, a]));
const byModel = Object.fromEntries(M.map((m) => [m.id, m]));

module.exports = { airports: A, models: M, GRADES, PRICE_SCALE, byIata, byModel };
