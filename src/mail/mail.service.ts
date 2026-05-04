import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class MailService {
  private resend: Resend;

  constructor(private config: ConfigService) {
    this.resend = new Resend(config.getOrThrow('RESEND_API_KEY'));
  }
async sendNewOrderNotification(order: any) {
  const address = order.address as any;

  await this.resend.emails.send({
    from: 'T-Shirt Studio <onboarding@resend.dev>',
    to: this.config.getOrThrow('PRINTER_EMAIL'),
    subject: `New Order #${order.id} — ${order.size} shirt`,
    html: `
      <div style="font-family: Arial; max-width: 600px;">
        <h2>New Order Received</h2>
        <table style="width:100%; border-collapse: collapse;">
          <tr>
            <td style="padding:8px; font-weight:bold;">Order ID</td>
            <td style="padding:8px;">#${order.id}</td>
          </tr>
          <tr style="background:#f5f5f5;">
            <td style="padding:8px; font-weight:bold;">Customer</td>
            <td style="padding:8px;">
              ${order.user?.name} (${order.user?.email})
            </td>
          </tr>
          <tr>
            <td style="padding:8px; font-weight:bold;">Size</td>
            <td style="padding:8px;">${order.size}</td>
          </tr>
          <tr style="background:#f5f5f5;">
            <td style="padding:8px; font-weight:bold;">Shirt Color</td>
            <td style="padding:8px;">${order.design?.shirtColor}</td>
          </tr>
          <tr>
            <td style="padding:8px; font-weight:bold;">Decals</td>
            <td style="padding:8px;">
              ${order.design?.decals?.length ?? 0} layer(s)
            </td>
          </tr>
          <tr style="background:#f5f5f5;">
            <td style="padding:8px; font-weight:bold;">Address</td>
            <td style="padding:8px;">
              ${address?.street ?? ''}, 
              ${address?.city ?? ''}, 
              ${address?.country ?? ''} 
              ${address?.zip ?? ''}
            </td>
          </tr>
          <tr>
            <td style="padding:8px; font-weight:bold;">Notes</td>
            <td style="padding:8px;">${order.notes ?? 'None'}</td>
          </tr>
        </table>
      </div>
    `,
  });
}
}