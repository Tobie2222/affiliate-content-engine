import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import {
  AddMemberDto,
  CreateOrganizationDto,
  UpdateMemberRoleDto,
  UpdateOrgSettingsDto,
} from './dto/organizations.dto';
import { OrgAccessGuard } from './org-access.guard';
import { OrganizationsService } from './organizations.service';
import { Permission } from './roles';

@ApiTags('organizations')
@ApiBearerAuth()
@Controller({ path: 'organizations', version: '1' })
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Post()
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateOrganizationDto) {
    return this.orgs.create(user.id, dto.name);
  }

  @Get()
  listMine(@CurrentUser() user: { id: string }) {
    return this.orgs.listMine(user.id);
  }

  @UseGuards(OrgAccessGuard)
  @Get(':orgId/settings')
  getSettings(@Param('orgId') orgId: string) {
    return this.orgs.getSettings(orgId);
  }

  @UseGuards(OrgAccessGuard)
  @RequirePermission(Permission.OrgManage)
  @Patch(':orgId/settings')
  updateSettings(
    @Param('orgId') orgId: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateOrgSettingsDto,
  ) {
    return this.orgs.updateSettings(orgId, this.actor(req).id, dto);
  }

  /** Mọi thành viên đều xem được danh sách thành viên của tổ chức mình. */
  @UseGuards(OrgAccessGuard)
  @Get(':orgId/members')
  listMembers(@Param('orgId') orgId: string) {
    return this.orgs.listMembers(orgId);
  }

  @UseGuards(OrgAccessGuard)
  @RequirePermission(Permission.MembersManage)
  @Post(':orgId/members')
  addMember(
    @Param('orgId') orgId: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: AddMemberDto,
  ) {
    return this.orgs.addMember(orgId, this.actor(req), dto.email, dto.role);
  }

  @UseGuards(OrgAccessGuard)
  @RequirePermission(Permission.MembersManage)
  @Patch(':orgId/members/:memberId')
  async changeRole(
    @Param('orgId') orgId: string,
    @Param('memberId', new ParseUUIDPipe()) memberId: string,
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateMemberRoleDto,
  ): Promise<void> {
    await this.orgs.changeRole(orgId, this.actor(req), memberId, dto.role);
  }

  @UseGuards(OrgAccessGuard)
  @RequirePermission(Permission.MembersManage)
  @HttpCode(204)
  @Delete(':orgId/members/:memberId')
  async removeMember(
    @Param('orgId') orgId: string,
    @Param('memberId', new ParseUUIDPipe()) memberId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.orgs.removeMember(orgId, this.actor(req), memberId);
  }

  private actor(req: AuthenticatedRequest) {
    // Đã được OrgAccessGuard điền sau khi xác nhận thành viên.
    return { id: req.user!.id, role: req.membership!.role };
  }
}
