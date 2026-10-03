import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { hash, compare } from 'bcryptjs';
import { sign } from 'jsonwebtoken';
import { User, UserRole } from '../../entities/user.entity';
import { Enterprise } from '../../entities/enterprise.entity';
import { config } from '../../config';

export class RegisterDto {
  username: string;
  password: string;
  name: string;
  phone: string;
  role: UserRole;
  idCardNo?: string;
  healthCertUntil?: string;
  enterpriseName?: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(Enterprise) private enterprises: Repository<Enterprise>,
  ) {}

  async register(dto: RegisterDto) {
    if (!dto.username || !dto.password || dto.password.length < 6) {
      throw new BadRequestException('用户名和至少 6 位密码必填');
    }
    if (!['WORKER', 'ENTERPRISE'].includes(dto.role)) {
      throw new BadRequestException('自助注册仅支持工人 / 企业账号');
    }
    const exists = await this.users.findOne({ where: { username: dto.username } });
    if (exists) throw new BadRequestException('用户名已被占用');

    const passwordHash = await hash(dto.password, 10);

    if (dto.role === 'ENTERPRISE') {
      const user = await this.users.save(this.users.create({
        username: dto.username,
        passwordHash,
        name: dto.name,
        phone: dto.phone,
        role: 'ENTERPRISE',
      }));
      const ent = await this.enterprises.save(this.enterprises.create({
        name: dto.enterpriseName || `${dto.name}的企业`,
        contactPhone: dto.phone,
        accountUserId: user.id,
      }));
      user.enterpriseId = ent.id; // 方便 JWT 附带
      await this.users.save(user);
      return { token: this.token(user, ent.id), user: this.publicUser(user, ent.id), enterpriseId: ent.id };
    }

    const user = await this.users.save(this.users.create({
      username: dto.username,
      passwordHash,
      name: dto.name,
      phone: dto.phone,
      role: 'WORKER',
      idCardNo: dto.idCardNo || null,
      idVerifiedAt: dto.idCardNo ? new Date() : null,
      healthCertUntil: dto.healthCertUntil || null,
      faceSampleUrl: null,
    }));
    return { token: this.token(user), user: this.publicUser(user) };
  }

  async login(username: string, password: string) {
    const user = await this.users.findOne({ where: { username } });
    if (!user) throw new UnauthorizedException('用户名或密码错误');
    const ok = await compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('用户名或密码错误');

    let enterpriseId = user.enterpriseId;
    if (user.role === 'ENTERPRISE') {
      const ent = await this.enterprises.findOne({ where: { accountUserId: user.id } });
      enterpriseId = ent?.id ?? null;
    }
    return { token: this.token(user, enterpriseId), user: this.publicUser(user, enterpriseId) };
  }

  async me(userId: number) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    let enterpriseId = user.enterpriseId;
    let enterprise: Enterprise | null = null;
    if (user.role === 'ENTERPRISE') {
      enterprise = await this.enterprises.findOne({ where: { accountUserId: user.id } }) || null;
      enterpriseId = enterprise?.id ?? null;
    }
    return { user: this.publicUser(user, enterpriseId), enterprise };
  }

  /** 工人补全实名 / 健康证 / 人脸样本 */
  async completeWorkerProfile(userId: number, dto: { idCardNo?: string; healthCertUntil?: string; faceSampleUrl?: string }) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user || user.role !== 'WORKER') throw new BadRequestException('仅工人账号可维护实名资料');
    if (dto.idCardNo && !user.idVerifiedAt) {
      user.idCardNo = dto.idCardNo;
      user.idVerifiedAt = new Date();
    }
    if (dto.healthCertUntil !== undefined) user.healthCertUntil = dto.healthCertUntil;
    if (dto.faceSampleUrl !== undefined) user.faceSampleUrl = dto.faceSampleUrl;
    await this.users.save(user);
    return this.publicUser(user);
  }

  private token(user: User, enterpriseId?: number | null) {
    return sign(
      { sub: user.id, role: user.role, name: user.name, enterpriseId: enterpriseId ?? user.enterpriseId ?? null },
      config.jwtSecret,
      { expiresIn: '7d' },
    );
  }

  private publicUser(user: User, enterpriseId?: number | null) {
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      phone: user.phone,
      role: user.role,
      enterpriseId: enterpriseId ?? user.enterpriseId ?? null,
      idCardNo: user.idCardNo,
      idVerified: !!user.idVerifiedAt,
      healthCertUntil: user.healthCertUntil,
      hasFaceSample: !!user.faceSampleUrl,
      walletBalance: Number(user.walletBalance || 0),
    };
  }
}
