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
// Para testar agora, troque '0 8 * * *' por '* * * * *' (corre a cada minuto)
cron.schedule('0 8 * * *', async () => {
  console.log('A verificar alunos inativos...');

  try {
    // Calcula a data de há 3 dias atrás
    const tresDiasAtras = new Date();
    tresDiasAtras.setDate(tresDiasAtras.getDate() - 3);

    const snapshot = await db.collection('users')
      .where('ultimaAtividade', '<', tresDiasAtras)
      .get();

    if (snapshot.empty) {
      console.log('Todos os alunos estão ativos!');
      return;
    }

    // Dispara o e-mail para cada aluno inativo
    snapshot.forEach(async (doc) => {
      const user = doc.data();
      
      if (user.email) {
        const mailOptions = {
          from: `"Cyber Tech" <${process.env.EMAIL_USER}>`,
          to: user.email,
          subject: 'Sentimos a sua falta nos Desafios! 🚀',
          html: `
            <h2>Olá ${user.name || 'Estudante'}, tudo bem?</h2>
            <p>Reparámos que já se passaram alguns dias desde o seu último acesso à <strong>Cyber Tech</strong>.</p>
            <p>Os seus certificados estão à sua espera! Volte para concluir as suas missões.</p>
            <br>
            <p>Um abraço,</p>
            <p><strong>A Equipa Cyber Tech</strong></p>
          `
        };

        try {
          await transporter.sendMail(mailOptions);
          console.log(`Lembrete enviado para: ${user.email}`);
        } catch (error) {
          console.error(`Erro ao enviar para ${user.email}:`, error);
        }
      }
    });

  } catch (error) {
    console.error('Erro na verificação diária:', error);
  }
});

console.log('Robô de inatividade iniciado e à espera do horário agendado...');