const express = require('express');
const router = express.Router();
const db = require('../db/connection');
const bcrypt = require('bcryptjs');

router.post('/run', async (req, res) => {
  const secret = req.headers['x-migrate-secret'];
  if (secret !== 'b44_migration_2026') return res.status(403).json({error: 'forbidden'});
  
  try {
    const hash = await bcrypt.hash('Lyjob2026', 12);
    const users = [
      ['9696job@gmail.com','Job Cherrez Yepez','admin'],
      ['jobcherrez@gmail.com','Job Cherrez','contador'],
      ['asistenteecucons@gmail.com','Asistente Ecucons','cargador'],
      ['evelyn_mora_burgos@outlook.es','Evelyn Mora Burgos','contador'],
      ['asistentetributario@ecuconsultores.com.ec','Asistente Tributario','contador'],
      ['geraldynicoletc@outlook.es','Geraldy Nicole','contador'],
      ['danielagomezf24@gmail.com','Daniela Gomez','contador']
    ];
    const clients = [
      ['ANANGONO LARA CARLOS ALBERTO','0913815460001'],
      ['AGRICOLAMAC CIA.LTDA.','0993400819001'],
      ['SALAME ILLINGWORTH CARLOS ANDRES','0913646204001'],
      ['HVACR TOOLS S.A.S.','0993385084001'],
      ['BURGOS OCHOA JOSE ANTONIO','0918554668001'],
      ['SOCIEDAD PROVEDORA Y ADMINISTRADORA DEL SISTEMA UNICO BURSATIL REDEVAL','0991371079001'],
      ['ARREGUI DIAZ ARMANDO ALEXANDER','0923380802001'],
      ['ERAZO TRIVINO MAURICIO EMANUEL','0925386435001'],
      ['MAECORP CONSULTORES C. LTDA.','0992306270001'],
      ['UNION MODERNA','0791843230001'],
      ['MIRANDA AREVALO KATHY DANIELA','0930032230001'],
      ['SUDAMERICANA DE SERVICIOS PRIVADOS INDUSTRIALES SUDSERPRI S.A.','0992868597001'],
      ['MONTORR S.A.S.','0993395750001'],
      ['JALCA GONZALEZ LEONARDO JAVIER','0909853327001'],
      ['MICHELLE OCANA','0942124363001'],
      ['BLACK VISION BVCORP S.A.S.','0993390625001'],
      ['GARCIA COELLO BRYAN FRANCISCO','0931938096001'],
      ['TROCOPERSA S.A.','0992853158001'],
      ['JOYASECUADOR S.A.','0993373317001'],
      ['QUEVEDO VALAREZO KAREN DANIELA','0921238465001'],
      ['ANA MARIA PENARREDONDA HIDALGO','1709414401001'],
      ['SALAME ILLINGWORTH JUAN CARLOS','0909883548001'],
      ['MURILLO HOLGUIN EDGAR AUGUSTO','0923516298001'],
      ['ODORISIO','0991250883001'],
      ['ROTHKO S.A.S.','0993386690001'],
      ['FRONTESA','0991410686001'],
      ['JAIME FREIRE','0902545896001'],
      ['JAIME MERO','0909003006001'],
      ['IMPORTADORA MAQUINAS Y EQUIPOS','0993032395001']
    ];
    
    await db.query('SET FOREIGN_KEY_CHECKS=0');
    let uOk=0, cOk=0;
    
    for(const [email, name, role] of users) {
      await db.query(
        `INSERT INTO users (id,email,password_hash,full_name,role,is_active,is_verified) VALUES (UUID(),?,?,?,?,1,1)
         ON DUPLICATE KEY UPDATE full_name=VALUES(full_name),role=VALUES(role),is_active=1,is_verified=1`,
        [email, hash, name, role]
      );
      uOk++;
    }
    
    for(const [name, ruc] of clients) {
      await db.query(
        `INSERT INTO clients (id,razon_social,ruc,status) VALUES (UUID(),?,?,'activo')
         ON DUPLICATE KEY UPDATE razon_social=VALUES(razon_social),status='activo'`,
        [name, ruc]
      );
      cOk++;
    }
    
    await db.query('SET FOREIGN_KEY_CHECKS=1');
    res.json({ok: true, usuarios: uOk, clientes: cOk});
  } catch(e) {
    res.status(500).json({error: e.message});
  }
});

module.exports = router;
