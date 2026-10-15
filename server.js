const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const DB_FILE = path.join(__dirname, 'city_db.json');

// =================================================================
// 🔧 הגדרות השרת ועמוד האינסטגרם שלך
// =================================================================
const IG_USERNAME = 'bananya_city';
const RAPIDAPI_HOST = 'instagram-scraper-stable-api.p.rapidapi.com';
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '37ca7a9740msheb86e5522414860p1b808djsnf28505cb664b';
const SYNC_INTERVAL_MS = 60000; // בדיקה אוטומטית כל דקה

const streetNames = [
  "הבננות האלגנטיות", "הדורבנים העגלגלים", "החלזונות הטרופיים",
  "הקופים המנומסים", "הקליפות המחליקות", "הפלמינגואים המבולבלים",
  "העצלנים החרוצים", "התוכים המזמרים", "השייקים המבעבעים",
  "האגוזים המעופפים", "הבבונים המשועשעים", "הדקלים המתנדנדים"
];

let cityData = {
  day: 1,
  totalFollowers: 0,
  houses: []
};

if (fs.existsSync(DB_FILE)) {
  try {
    cityData = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    console.error('מאתחל מסד נתונים חדש.');
  }
}

function saveCity() {
  fs.writeFileSync(DB_FILE, JSON.stringify(cityData, null, 2), 'utf8');
}

// פונקציה ראשית שבונה בית חדש לעוקב או לתושב
function registerFollower(username) {
  if (!username) return null;
  const cleanUser = username.trim().replace(/^@/, '').toLowerCase();
  if (!cleanUser) return null;

  // בדיקה אם למשתמש כבר יש בית בעיר
  const existingHouse = cityData.houses.find(h =>
    h.residents.some(r => r.toLowerCase() === cleanUser)
  );
  if (existingHouse) return { house: existingHouse, isNew: false };

  const houseNumber = cityData.houses.length + 1;
  const streetBase = streetNames[(houseNumber - 1) % streetNames.length];
  const buildingNum = Math.floor((houseNumber - 1) / streetNames.length) + 1;

  const newHouse = {
    houseNumber,
    street: `${streetBase} ${buildingNum}`,
    residents: [cleanUser],
    createdAt: Date.now()
  };

  cityData.houses.push(newHouse);
  cityData.totalFollowers = Math.max(cityData.totalFollowers, cityData.houses.length);
  saveCity();

  console.log(`🍌 נבנה בית #${houseNumber} (${newHouse.street}) עבור @${cleanUser}`);
  return { house: newHouse, isNew: true };
}

// =================================================================
// 🔄 סנכרון אוטומטי מול אינסטגרם (ברקע)
// =================================================================
async function syncFollowersFromInstagram() {
  try {
    console.log(`🔍 בודק עוקבים חדשים בעמוד @${IG_USERNAME}...`);

    const buildForm = () => {
      const form = new FormData();
      form.append('username_or_url', IG_USERNAME);
      form.append('username', IG_USERNAME);
      return form;
    };

    const headers = {
      'accept': 'application/json',
      'x-rapidapi-host': RAPIDAPI_HOST,
      'x-rapidapi-key': RAPIDAPI_KEY
    };

    const response = await fetch(`https://${RAPIDAPI_HOST}/get_ig_user_followers.php`, {
      method: 'POST',
      headers,
      body: buildForm()
    });

    if (response.ok) {
      const data = await response.json();
      const list =
        data?.followers ||
        data?.users ||
        data?.data?.items ||
        data?.items ||
        [];

      if (Array.isArray(list) && list.length > 0) {
        let added = 0;
        list.forEach(item => {
          const uname = item?.username || item?.user?.username;
          if (uname) {
            const r = registerFollower(uname);
            if (r && r.isNew) added++;
          }
        });
        if (added > 0) {
          console.log(`🎉 נוספו ${added} בתים חדשים מרשימת העוקבים באינסטגרם!`);
        }
      }
    }
  } catch (err) {
    console.error('⚠️ שגיאה זמנית בסנכרון הרקע (ממשיך לעבוד רגיל):', err.message);
  }
}

// הפעלת הסנכרון ברקע כל דקה
syncFollowersFromInstagram();
setInterval(syncFollowersFromInstagram, SYNC_INTERVAL_MS);

// =================================================================
// 🌐 נתיבי ה-API של האתר
// =================================================================

app.get('/api/city', (req, res) => {
  res.json(cityData);
});

// כאשר גולש מקליד את שם המשתמש שלו באתר ("איפה הבית שלי?")
app.post('/api/claim-house', (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'נא להזין שם משתמש' });

  const result = registerFollower(username);
  if (!result) return res.status(400).json({ error: 'שם משתמש לא תקין' });

  res.json(result);
});

// סנכרון דמויות השחקנים המסתובבים בעיר בזמן אמת
const activePlayers = new Map();

app.post('/api/players', (req, res) => {
  const { id, colorHex, hatType, x, z, chat } = req.body;
  if (id) {
    const prev = activePlayers.get(id) || {};
    activePlayers.set(id, {
      id,
      colorHex: colorHex || 0xFFE135,
      hatType: hatType || 'banana',
      x: Number(x) || 0,
      z: Number(z) || 24,
      chat: chat || prev.chat || '',
      lastSeen: Date.now()
    });
  }

  const now = Date.now();
  for (const [pid, pdata] of activePlayers.entries()) {
    if (now - pdata.lastSeen > 15000) activePlayers.delete(pid);
  }

  res.json(Array.from(activePlayers.values()));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🍌 בנניה באוויר ומחוברת אל @${IG_USERNAME}!`);
  console.log(`🌐 כנס בדפדפן: http://localhost:${PORT}`);
  console.log(`====================================================`);
});