import nodemailer, { SendMailOptions } from 'nodemailer';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

const sesClient = new SESv2Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SECRET_KEY
  }
});
let transporter = nodemailer.createTransport({
  SES: { sesClient, SendEmailCommand }
});

export const sendEmail = async (options: SendMailOptions) => {
  // default ot noreply@viralmind.ai
  if (!options.from) {
    options.from = {
      name: 'Viralmind',
      address: 'noreply@viralmind.ai'
    };
  }
  const emailRes = await transporter.sendMail(options).catch((e) => {
    console.log(e);
    throw Error('There was an error sending the email.');
  });

  if (emailRes.rejected) {
    console.log(emailRes);
    throw Error('There was an error sending the email.');
  }
  console.log(`[Emails] Succesffully sent email to ${options.to}`);
};
