const nodemailer = require('nodemailer');
const logger = require('./logger');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '465'),
  secure: true, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

/**
 * Envoie un email d'invitation/vérification
 */
async function sendInviteEmail(to, inviteUrl) {
  const mailOptions = {
    from: `"SecureVault" <${process.env.SMTP_USER}>`,
    to: to,
    subject: 'Finalisez votre inscription sur SecureVault',
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
        <h2 style="color: #F97316;">Bienvenue sur SecureVault</h2>
        <p>Vous avez demandé à créer un compte SecureVault.</p>
        <p>Cliquez sur le bouton ci-dessous pour définir votre mot de passe maître et activer votre coffre-fort :</p>
        <div style="text-align: center; margin: 2rem 0;">
          <a href="${inviteUrl}" style="background: #F97316; color: white; padding: 0.75rem 1.5rem; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">Définir mon mot de passe maître</a>
        </div>
        <p style="font-size: 0.875rem; color: #666;">Ce lien expirera dans 30 minutes.</p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 2rem 0;">
        <p style="font-size: 0.75rem; color: #999;">Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet email.</p>
      </div>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    logger.info('Email sent successfully', { messageId: info.messageId, to });
    return true;
  } catch (error) {
    logger.error('Failed to send email', { error: error.message, to });
    return false;
  }
}

module.exports = {
  sendInviteEmail
};
