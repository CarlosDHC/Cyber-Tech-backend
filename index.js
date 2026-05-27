require('dotenv').config();
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const express = require('express');

// Inicializa o Express (Mini-servidor para o Render não reclamar)
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('O Robô da Cyber Tech está online e a monitorizar inatividade! 🤖');
});

app.listen(PORT, () => {
  console.log(`Servidor a correr na porta ${PORT}`);
});

// 1. Conexão Segura com o Firebase
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// 2. Configuração do Gmail para envio
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS 
  }
});

// 3. Tarefa Agendada (Corre todos os dias às 08:00)
// 3. Tarefa Agendada (A CORRER A CADA 30 MINUTOS PARA TESTE)
cron.schedule('*/30 * * * *', async () => {
  console.log('A verificar alunos inativos (Modo Teste: a cada 30 min)...');

  try {
    // TEMPORÁRIO PARA TESTE: Calcula a data de há 3 MINUTOS atrás
    const tresMinutosAtras = new Date();
    tresMinutosAtras.setMinutes(tresMinutosAtras.getMinutes() - 3);

    // Procura utilizadores cuja última atividade foi antes desses 3 minutos
    const snapshot = await db.collection('users')
      .where('ultimaAtividade', '<', tresMinutosAtras)
      .get();

    if (snapshot.empty) {
      console.log('Nenhum aluno inativo encontrado neste ciclo de teste.');
      return;
    }

    // Dispara o e-mail para cada aluno inativo
    snapshot.forEach(async (doc) => {
      const user = doc.data();
      
      if (user.email) {
        const mailOptions = {
          from: `"Cyber Tech" <${process.env.EMAIL_USER}>`,
          to: user.email,
          subject: 'Teste de Inatividade! 🚀',
          html: `
            <h2>Olá ${user.name || 'Estudante'}, este é um e-mail de teste!</h2>
            <p>Se você está a receber isto, significa que o nosso robô detetou inatividade de 3 minutos e o cron job está a funcionar perfeitamente a cada meia hora.</p>
          `
        };

        try {
          await transporter.sendMail(mailOptions);
          console.log(`Lembrete enviado com sucesso para: ${user.email}`);
        } catch (error) {
          console.error(`Erro ao enviar para ${user.email}:`, error);
        }
      }
    });

  } catch (error) {
    console.error('Erro na verificação do cron job:', error);
  }
});