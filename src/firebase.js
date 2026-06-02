// ============================================================
// PASSO 1: Cole aqui as configurações do seu projeto Firebase
// Veja o guia COMO_PUBLICAR.md para saber como obter esses dados
// ============================================================

import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCB-qpmK9Tp4WipZqYdl0v404cUctOTn0I",
  authDomain: "gestao-pagamentos1201.firebaseapp.com",
  projectId: "gestao-pagamentos1201",
  storageBucket: "gestao-pagamentos1201.firebasestorage.app",
  messagingSenderId: "345091207126",
  appId: "1:345091207126:web:6b5f4b974495950f0c3e77"
};

const app = initializeApp(firebaseConfig);
export const db   = getFirestore(app);
export const auth = getAuth(app);
