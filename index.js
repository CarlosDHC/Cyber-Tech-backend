require('dotenv').config();
const admin = require('firebase-admin');
const cron = require('node-cron');
const express = require('express');
const cors = require('cors'); 
const { createClient } = require('redis'); 

const app = express();
const PORT = process.env.PORT || 3000;

// 1. Configurações do Express para receber chamadas do Frontend
app.use(cors({ origin: '*' })); 
app.use(express.json()); 

// 2. Conexão Segura com o Firebase
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// --- SECÇÃO: CONFIGURAÇÃO DO REDIS ---
const redisClient = createClient({ 
  url: process.env.REDIS_URL || 'redis://127.0.0.1:6379' 
});

redisClient.connect()
  .then(() => console.log('Ligado ao banco de dados em memória Redis com sucesso! 🗄️'))
  .catch(console.error);

// 30 minutos em segundos (Pode reduzir este valor depois para os testes de sessão)
const TEMPO_INATIVIDADE_TESTE = 1800; 

// Endpoint para renovar a sessão do utilizador
app.post('/api/heartbeat', async (req, res) => {
  const { uid } = req.body;
  if (!uid) return res.status(400).send('UID obrigatório');

  try {
    await redisClient.set(`session:${uid}`, 'ativo', {
      EX: TEMPO_INATIVIDADE_TESTE
    });
    
    // Sincroniza o robô de e-mails com a atividade real captada pelo Redis.
    await db.collection('users').doc(uid).set({
      ultimaAtividade: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    // Mensagem opcional para ver a atividade no painel do Render
    console.log(`📡 Atividade detetada! Sessão renovada para: ${uid}`);

    res.sendStatus(200);
  } catch (error) {
    console.error('Erro no heartbeat:', error);
    res.status(500).send('Erro interno');
  }
});

// Endpoint para o frontend verificar se foi desconectado
app.post('/api/check-session', async (req, res) => {
  const { uid } = req.body;
  if (!uid) return res.status(400).send('UID obrigatório');

  try {
    const session = await redisClient.get(`session:${uid}`);
    if (!session) {
      return res.status(401).json({ expired: true });
    }
    res.status(200).json({ expired: false });
  } catch (error) {
    console.error('Erro ao verificar sessão:', error);
    res.status(500).send('Erro interno');
  }
});
// ------------------------------------------

app.get('/', (req, res) => {
  res.send('O Robô da Cyber Tech está online, a monitorizar inatividade e com Redis ativo! 🤖');
});

// 4. Tarefa Agendada (ALTERADO PARA CORRER A CADA 2 MINUTOS)
cron.schedule('*/2 * * * *', async () => {
  console.log('A verificar alunos inativos (Modo Teste: a cada 2 min)...');

  try {
    // Procura quem não mexe há mais de 2 minutos
    const doisMinutosAtras = new Date();
    doisMinutosAtras.setMinutes(doisMinutosAtras.getMinutes() - 2);

    const snapshot = await db.collection('users')
      .where('ultimaAtividade', '<', doisMinutosAtras)
      .get();

    if (snapshot.empty) {
      console.log('Nenhum aluno inativo encontrado neste ciclo de teste.');
      return;
    }

    snapshot.forEach(async (doc) => {
      const user = doc.data();
      
      if (user.email) {
        try {
          // Usando a porta segura 443 via Brevo API em vez do Nodemailer
          const response = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
              'accept': 'application/json',
              'api-key': process.env.BREVO_API_KEY, 
              'content-type': 'application/json'
            },
            body: JSON.stringify({
              sender: { email: process.env.EMAIL_USER, name: 'Robô Cyber Tech' },
              to: [{ email: user.email }],
              subject: 'Teste de Inatividade! 🚀',
              htmlContent: `
                <h2>Olá ${user.name || 'Estudante'}, este é um e-mail de teste!</h2>
                <p>Se você está a receber isto, significa que o nosso robô detetou inatividade (mais de 2 minutos sem interação) e o envio via API HTTP está a funcionar perfeitamente.</p>
                <p><strong>Esta verificação ocorre a cada 2 minutos.</strong></p>
              `
            })
          });

          if (response.ok) {
            console.log(`Lembrete HTTP enviado com sucesso para: ${user.email}`);
          } else {
            const erroAPI = await response.text();
            console.error(`Falha na API ao enviar para ${user.email}. Detalhes:`, erroAPI);
          }
        } catch (error) {
          console.error(`Erro crítico de comunicação com a Brevo para ${user.email}:`, error);
        }
      }
    });
  } catch (error) {
    console.error('Erro na verificação do cron job:', error);
  }
});

app.listen(PORT, () => {
  console.log(`Servidor a correr na porta ${PORT}`);
});