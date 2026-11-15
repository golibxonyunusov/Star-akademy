// Firebase konsolidan olingan "Web app" sozlamalari (loyiha: star-akademy).
export const firebaseConfig = {
  apiKey: "AIzaSyDyMydmshz_9D0gJkQRSP7u4RCXvlhijkk",
  authDomain: "star-akademy.firebaseapp.com",
  projectId: "star-akademy",
  storageBucket: "star-akademy.firebasestorage.app",
  messagingSenderId: "951154176756",
  appId: "1:951154176756:web:ea8572af3fe929b56624a1",
  measurementId: "G-GPB0BVY5RE"
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