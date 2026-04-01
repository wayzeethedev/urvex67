// /api/locations.js
// Handles: GET /api/locations
//          POST /api/locations
//          PATCH /api/locations/:id
//          DELETE /api/locations/:id

const { MongoClient, ObjectId } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = 'urbexdb';
const COLLECTION = 'locations';

let cachedClient = null;

async function getDb() {
  if (!cachedClient) {
    cachedClient = new MongoClient(MONGO_URI);
    await cachedClient.connect();
  }
  return cachedClient.db(DB_NAME).collection(COLLECTION);
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  // Preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { url, method } = req;

  // Extract id from path e.g. /api/locations/abc123
  const idMatch = url.match(/\/api\/locations\/([^?/]+)/);
  const id = idMatch ? idMatch[1] : null;

  try {
    const col = await getDb();

    // ── GET all locations ──────────────────────
    if (method === 'GET' && !id) {
      const docs = await col.find({}).sort({ createdAt: -1 }).toArray();
      return res.status(200).json(docs.map(serializeDoc));
    }

    // ── POST create location ───────────────────
    if (method === 'POST') {
      const { title, description, imageUrl, latitude, longitude } = req.body;

      if (!title || latitude === undefined || longitude === undefined) {
        return res.status(400).json({ error: 'title, latitude, and longitude are required' });
      }

      const doc = {
        title: String(title).trim(),
        description: description ? String(description).trim() : '',
        imageUrl: imageUrl ? String(imageUrl).trim() : '',
        latitude: Number(latitude),
        longitude: Number(longitude),
        visited: false,
        createdAt: new Date()
      };

      const result = await col.insertOne(doc);
      return res.status(201).json(serializeDoc({ ...doc, _id: result.insertedId }));
    }

    // ── PATCH update location ──────────────────
    if (method === 'PATCH' && id) {
      if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid ID' });

      const allowed = ['title', 'description', 'imageUrl', 'latitude', 'longitude', 'visited'];
      const updates = {};

      for (const key of allowed) {
        if (req.body[key] !== undefined) {
          if (key === 'latitude' || key === 'longitude') updates[key] = Number(req.body[key]);
          else if (key === 'visited') updates[key] = Boolean(req.body[key]);
          else updates[key] = String(req.body[key]).trim();
        }
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      const result = await col.findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: updates },
        { returnDocument: 'after' }
      );

      if (!result) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json(serializeDoc(result));
    }

    // ── DELETE location ────────────────────────
    if (method === 'DELETE' && id) {
      if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid ID' });

      const result = await col.deleteOne({ _id: new ObjectId(id) });
      if (result.deletedCount === 0) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json({ success: true, id });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error('[API Error]', err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
};

function serializeDoc(doc) {
  return {
    ...doc,
    _id: doc._id.toString()
  };
}