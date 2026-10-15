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
// 🔧 ההגדרות שלך מ-RapidAPI (כבר מוכנות ומחוברות!)
// =================================================================
const IG_USERNAME  = 'bananya_city';
const RAPIDAPI_HOST = 'instagram-scraper-stable-api.p.rapidapi.com';
const RAPIDAPI_KEY  = process.env.RAPIDAPI_KEY || '37ca7a9740msheb86e5522414860p1b808djsnf28505cb664b';
const SYNC_INTERVAL_MS = 30000; // בדיקה אוטומטית כל 30 שניות

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

// פונקציה שבונה בית חדש לעוקב (לפי שם משתמש או לפי מספר העוקב)
function registerFollower(username) {
  if (!username) return null;
  const cleanUser = username.trim().replace(/^@/, '').toLowerCase();
  if (!cleanUser) return null;

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
// 🔄 סנכרון אוטומטי מול instagram-scraper-stable-api
// =================================================================
async function syncFollowersFromInstagram() {
  try {
    console.log(`🔍 בודק עוקבים חדשים בעמוד @${IG_USERNAME}...`);

    // בניית בקשת multipart/form-data כפי שמוגדר ב-API שבחרת
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

    // 1. ניסיון שליפת רשימת העוקבים המלאה (שמות משתמשים)
    const followersRes = await fetch(`https://${RAPIDAPI_HOST}/get_ig_user_followers.php`, {
      method: 'POST',
      headers,
      body: buildForm()
    });

    if (followersRes.ok) {
      const data = await followersRes.json();
      const list =
        data?.followers ||
        data?.users ||
        data?.data?.items ||
        data?.items ||
        [];

      if (Array.isArray(list) && list.length > 0) {
        const ordered = [...list].reverse();
        let added = 0;
        ordered.forEach(item => {
          const uname = item?.username || item?.user?.username;
          if (uname) {
            const r = registerFollower(uname);
            if (r && r.isNew) added++;
          }
        });
        if (added > 0) {
          console.log(`🎉 נוספו ${added} בתים חדשים מרשימת העוקבים!`);
        }
      }
    }

    // 2. בדיקת כמות העוקבים הכוללת בעמוד (מוודא שכל עוקב חדש בונה בית מיד)
    const profileRes = await fetch(`https://${RAPIDAPI_HOST}/ig_get_fb_profile_hover.php`, {
      method: 'POST',
      headers,
      body: buildForm()
    });

    if (profileRes.ok) {
      const pData = await profileRes.json();
      const count =
        Number(pData?.user_data?.follower_count) ||
        Number(pData?.follower_count) ||
        Number(pData?.data?.follower_count) ||
        0;

      if (count > cityData.houses.length) {
        const diff = count - cityData.houses.length;
        for (let i = 0; i < diff; i++) {
          const nextNum = cityData.houses.length + 1;
          registerFollower(`resident_${nextNum}`);
        }
        console.log(`🏠 סונכרנו ${diff} בתים חדשים לפי מונה העוקבים (${count} עוקבים)!`);
      }
    }
  } catch (err) {
    console.error('⚠️ שגיאה בסנכרון מול אינסטגרם:', err.message);
  }
}

syncFollowersFromInstagram();
setInterval(syncFollowersFromInstagram, SYNC_INTERVAL_MS);

// =================================================================
// 🌐 נתיבי ה-API של האתר והשחקנים
// =================================================================

app.get('/api/city', (req, res) => {
  res.json(cityData);
});

// חיפוש "איפה הבית שלי?" - משייך לעוקב את הבית שלו
app.post('/api/claim-house', (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'נא להזין שם משתמש' });

  const cleanUser = username.trim().replace(/^@/, '').toLowerCase();

  // אם יש בית שנבנה עם שם זמני (resident_X), נחליף אותו לשם האמיתי של העוקב!
  const placeholderHouse = cityData.houses.find(h =>
    h.residents.length === 1 && h.residents[0].startsWith('resident_')
  );
  const alreadyExists = cityData.houses.find(h =>
    h.residents.some(r => r.toLowerCase() === cleanUser)
  );

  if (!alreadyExists && placeholderHouse) {
    placeholderHouse.residents = [cleanUser];
    saveCity();
    return res.json({ house: placeholderHouse, isNew: false });
  }

  const result = registerFollower(cleanUser);
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