require('dotenv').config();
const admin = require('firebase-admin');
const cron = require('node-cron');
const express = require('express');
const cors = require('cors'); 
const { createClient } = require('redis'); 

const app = express();
const PORT = process.env.PORT || 3000;

// 1. Configuracións de Express (CORS e JSON)
app.use(cors({ origin: '*' })); 
app.use(express.json()); 

// 2. Conexión Segura con Firebase
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

//  SECCIÓN: CONFIGURACIÓN DO REDIS 
const redisClient = createClient({ 
  url: process.env.REDIS_URL || 'redis://127.0.0.1:6379' 
});

redisClient.connect()
  .then(() => console.log('Ligado ao banco de datos en memoria Redis con éxito! 🗄️'))
  .catch(console.error);

// 12 horas en segundos (12 * 60 * 60) o teste de 2 minutos --> 1800
const TEMPO_INATIVIDADE = 1800; 

// Endpoint para renovar a sesión do usuario
app.post('/api/heartbeat', async (req, res) => {
  const { uid } = req.body;
  if (!uid) return res.status(400).send('UID obrigatorio');

  try {
    await redisClient.set(`session:${uid}`, 'ativo', {
      EX: TEMPO_INATIVIDADE
    });
    
    // Sincroniza co Firestore
    await db.collection('users').doc(uid).set({
      ultimaAtividade: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    res.sendStatus(200);
  } catch (error) {
    console.error('Erro no heartbeat:', error);
    res.status(500).send('Erro interno');
  }
});

// Endpoint para verificar a sesión (Chamado polo frontend)
app.post('/api/check-session', async (req, res) => {
  const { uid } = req.body;
  if (!uid) return res.status(400).send('UID obrigatorio');

  try {
    const session = await redisClient.get(`session:${uid}`);
    if (!session) {
      return res.status(401).json({ expired: true });
    }
    res.status(200).json({ expired: false });
  } catch (error) {
    console.error('Erro ao verificar sesión:', error);
    res.status(500).send('Erro interno');
  }
});
// ---

app.get('/', (req, res) => {
  res.send('O sistema de xestión da Cyber Tech está en liña e monitorizando as sesións. 🤖');
});

// 4. Tarefa Programada (Corre cada 30 minutos para buscar inactivos de 12 horas)
cron.schedule('*/30 * * * *', async () => {
  console.log('Verificando usuarios inactivos...');

  try {
    // Calcula exactamente a hora de hai 12 horas
    const limiteInatividade = new Date();
    limiteInatividade.setHours(limiteInatividade.getHours() - 12);

    const snapshot = await db.collection('users')
      .where('ultimaAtividade', '<', limiteInatividade)
      .get();

    if (snapshot.empty) {
      return; // Se non hai ninguén, remata en silencio
    }

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
              sender: { email: process.env.EMAIL_USER, name: 'Equipe Cyber Tech' },
              to: [{ email: user.email }],
              subject: 'Aviso de Segurança: Sessão Expirada por Inatividade',
              htmlContent: `
                <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
                  <div style="background-color: #0056b3; padding: 20px; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Cyber Tech</h1>
                  </div>
                  <div style="padding: 30px;">
                    <h2 style="color: #0056b3; font-size: 20px; margin-top: 0;">Olá, ${user.name || 'Estudante'}.</h2>
                    <p style="font-size: 16px; line-height: 1.5;">Informamos que a sua sessão na plataforma <strong>Cyber Tech</strong> foi encerrada automaticamente devido a um período de inatividade superior a 12 horas.</p>
                    <p style="font-size: 16px; line-height: 1.5;">Esta é uma medida de segurança padrão para proteger os seus dados e o progresso dos seus estudos. Para retomar as suas atividades e aceder aos seus cursos, basta realizar um novo acesso.</p>
                    <div style="text-align: center; margin: 30px 0;">
                      <a href="https://cyber-tech-project.web.app/" style="background-color: #0056b3; color: #ffffff; text-decoration: none; padding: 12px 25px; border-radius: 5px; font-weight: bold; font-size: 16px;">Fazer Login Novamente</a>
                    </div>
                    <p style="font-size: 14px; color: #777; margin-top: 30px;">Se você não reconhece esta atividade ou precisa de suporte, por favor, entre em contacto com a nossa equipa técnica.</p>
                  </div>
                  <div style="background-color: #f4f4f4; padding: 15px; text-align: center; font-size: 12px; color: #888;">
                    &copy; ${new Date().getFullYear()} Cyber Tech. Todos os direitos reservados.
                  </div>
                </div>
              `
            })
          });

          if (response.ok) {
            console.log(`Aviso de inactividade enviado con éxito a: ${user.email}`);
          }
        } catch (error) {
          console.error(`Erro ao comunicar con Brevo para ${user.email}:`, error);
        }
      }
    });
  } catch (error) {
    console.error('Erro na verificación do cron job:', error);
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});