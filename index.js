require('dotenv').config();
const admin = require('firebase-admin');
const cron = require('node-cron');
const express = require('express');
const cors = require('cors'); 
const { createClient } = require('redis'); 

const app = express();
const PORT = process.env.PORT || 3000;

// 1. Configurações do Express (CORS e JSON)
app.use(cors({ origin: '*' })); 
app.use(express.json()); 

// 2. Conexão Segura com o Firebase
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// 3. Configuração do Redis
const redisClient = createClient({ 
  url: process.env.REDIS_URL || 'redis://127.0.0.1:6379' 
});

redisClient.connect()
  .then(() => console.log('Ligado ao banco de dados em memória Redis com sucesso! 🗄️'))
  .catch(console.error);

// --- OFICIAL: 12 horas de inatividade em segundos (12 * 60 * 60) ---
const TEMPO_INATIVIDADE = 43200; 

// ==========================================
// ROTAS DA API
// ==========================================

// Endpoint para renovar a sessão do utilizador (Heartbeat)
app.post('/api/heartbeat', async (req, res) => {
  const { uid } = req.body;
  if (!uid) return res.status(400).send('UID obrigatório');

  try {
    // Guarda a atividade no Redis
    await redisClient.set(`session:${uid}`, 'ativo', {
      EX: TEMPO_INATIVIDADE
    });
    
    // Sincroniza a atividade no Firestore
    await db.collection('users').doc(uid).set({
      ultimaAtividade: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    res.sendStatus(200);
  } catch (error) {
    console.error('Erro no heartbeat:', error);
    res.status(500).send('Erro interno');
  }
});

// Endpoint para verificar se a sessão expirou
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

// Endpoint para notificar o login (Com proteção Anti-Spam do Redis)
app.post('/api/notify-login', async (req, res) => {
  const { uid, email, name } = req.body;
  if (!uid || !email) return res.status(400).send('UID e Email obrigatórios');

  try {
    // Verifica no Redis se este utilizador já recebeu um aviso nas últimas 2h
    const jaNotificado = await redisClient.get(`login_alert:${uid}`);

    if (!jaNotificado) {
      // Dispara o e-mail de segurança via Brevo
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'api-key': process.env.BREVO_API_KEY, 
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          sender: { email: process.env.EMAIL_USER, name: 'Segurança Cyber Tech' },
          to: [{ email: email }],
          subject: 'Alerta de Segurança: Novo Login Detetado',
          htmlContent: `
            <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
              <div style="background-color: #28a745; padding: 20px; text-align: center;">
                <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Cyber Tech</h1>
              </div>
              <div style="padding: 30px;">
                <h2 style="color: #28a745; font-size: 20px; margin-top: 0;">Novo Acesso Detetado</h2>
                <p style="font-size: 16px; line-height: 1.5;">Olá, <strong>${name || 'Estudante'}</strong>.</p>
                <p style="font-size: 16px; line-height: 1.5;">Informamos que a sua conta foi acedida com sucesso na nossa plataforma de estudos.</p>
                <p style="font-size: 16px; line-height: 1.5;">Data e Hora do Acesso: <strong>${new Date().toLocaleString('pt-PT')}</strong></p>
                <p style="font-size: 14px; color: #555; margin-top: 20px;">Se foi você, não é necessária nenhuma ação. Caso não reconheça este login, recomendamos que redefina a sua palavra-passe imediatamente e contacte o nosso suporte.</p>
              </div>
              <div style="background-color: #f4f4f4; padding: 15px; text-align: center; font-size: 12px; color: #888;">
                &copy; ${new Date().getFullYear()} Cyber Tech. Todos os direitos reservados.
              </div>
            </div>
          `
        })
      });

      if (response.ok) {
        // Guarda a chave no Redis por 2 horas (7200 segundos) para bloquear spam
        await redisClient.set(`login_alert:${uid}`, 'notificado', { EX: 7200 });
        console.log(`✉️ Alerta de login enviado para: ${email}`);
      } else {
        console.error(`Erro na API Brevo ao notificar login:`, await response.text());
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error('Erro ao notificar login:', error);
    res.status(500).send('Erro interno');
  }
});

// Rota de verificação do estado do servidor
app.get('/', (req, res) => {
  res.send('O sistema de gestão da Cyber Tech está online e a monitorizar as sessões. 🤖');
});


// ==========================================
// CRON JOB: VERIFICAÇÃO DE INATIVIDADE (12 HORAS)
// ==========================================
// Corre a cada 30 minutos para poupar recursos
cron.schedule('*/30 * * * *', async () => {
  console.log('A verificar utilizadores inativos...');

  try {
    // --- OFICIAL: 12 horas atrás ---
    const limiteInatividade = new Date();
    limiteInatividade.setHours(limiteInatividade.getHours() - 12);

    const snapshot = await db.collection('users')
      .where('ultimaAtividade', '<', limiteInatividade)
      .get();

    if (snapshot.empty) return;

    snapshot.forEach(async (doc) => {
      const user = doc.data();
      
      if (user.email) {
        try {
          const response = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
              'accept': 'application/json',
              'api-key': process.env.BREVO_API_KEY, 
              'content-type': 'application/json'
            },
            body: JSON.stringify({
              sender: { email: process.env.EMAIL_USER, name: 'Equipa Cyber Tech' },
              to: [{ email: user.email }],
              subject: 'Aviso: Sessão Expirada por Inatividade',
              htmlContent: `
                <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
                  <div style="background-color: #0056b3; padding: 20px; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Cyber Tech</h1>
                  </div>
                  <div style="padding: 30px;">
                    <h2 style="color: #0056b3; font-size: 20px; margin-top: 0;">Olá, ${user.name || 'Estudante'}.</h2>
                    <p style="font-size: 16px; line-height: 1.5;">Informamos que a sua sessão na plataforma <strong>Cyber Tech</strong> foi encerrada automaticamente devido a um período de inatividade superior a <strong>12 horas</strong>.</p>
                    <p style="font-size: 16px; line-height: 1.5;">Esta é uma medida de segurança padrão para proteger os seus dados e o progresso dos seus estudos. Para retomar as suas atividades e aceder aos conteúdos, basta realizar um novo login.</p>
                    <div style="text-align: center; margin: 30px 0;">
                      <a href="https://cyber-tech-project.web.app/" style="background-color: #0056b3; color: #ffffff; text-decoration: none; padding: 12px 25px; border-radius: 5px; font-weight: bold; font-size: 16px;">Fazer Login Novamente</a>
                    </div>
                    <p style="font-size: 14px; color: #777; margin-top: 30px;">Se precisa de suporte, por favor, entre em contacto com a nossa equipa técnica.</p>
                  </div>
                  <div style="background-color: #f4f4f4; padding: 15px; text-align: center; font-size: 12px; color: #888;">
                    &copy; ${new Date().getFullYear()} Cyber Tech. Todos os direitos reservados.
                  </div>
                </div>
              `
            })
          });

          if (response.ok) {
            console.log(`Lembrete de inatividade enviado para: ${user.email}`);
          }
        } catch (error) {
          console.error(`Erro ao comunicar com a Brevo para ${user.email}:`, error);
        }
      }
    });
  } catch (error) {
    console.error('Erro na verificação do cron job:', error);
  }
});

// Inicia o servidor
app.listen(PORT, () => {
  console.log(`Servidor a correr na porta ${PORT}`);
});