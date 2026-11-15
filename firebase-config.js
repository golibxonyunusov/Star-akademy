// Firebase konsolidan olingan "Web app" sozlamalarini shu yerga qo'ying.
// Project settings -> General -> Your apps -> Web app -> Config
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Ovozli chat (WebRTC) uchun ICE serverlar.
// STUN ko'pchilik tarmoqlarda yetadi. Ba'zi mobil operatorlar va korxona tarmoqlarida
// TURN server ham kerak bo'ladi (masalan Metered, Cloudflare yoki o'zingizning coturn).
// TURN qo'shish uchun quyidagi qatorni oching va ma'lumotlarini yozing:
export const iceServers = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" }
  // { urls: "turn:turn.example.com:3478", username: "USER", credential: "PASSWORD" }
];
