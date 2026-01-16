import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

export default async function handler(req, res) {
  try {
    const { token } = req.body;
    const decoded = await admin.auth().verifyIdToken(token);

    res.status(200).json({
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name,
    });
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}
