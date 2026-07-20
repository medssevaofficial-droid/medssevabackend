import { branchRepository } from '../repositories/branch.repository';

export const branchService = {
  getAllBranches: async (query: {
    isActive?: string;
    homeCollection?: string;
    labVisit?: string;
  }) => {
    const filters: any = {};
    if (query.isActive !== undefined) filters.isActive = query.isActive === 'true';
    if (query.homeCollection === 'true') filters.homeCollection = true;
    if (query.labVisit === 'true') filters.labVisit = true;
    return branchRepository.findAll(filters);
  },

  getBranchById: async (id: string) => {
    const branch = await branchRepository.findById(id);
    if (!branch) throw new Error('Branch not found');
    return branch;
  },

  createBranch: async (data: any) => {
    const existing = await branchRepository.findByCode(data.code);
    if (existing) throw new Error('Branch code already exists');
    return branchRepository.create(data);
  },

  updateBranch: async (id: string, data: any) => {
    await branchService.getBranchById(id);
    if (data.code) {
      const existing = await branchRepository.findByCode(data.code);
      if (existing && existing.id !== id) throw new Error('Branch code already in use');
    }
    return branchRepository.update(id, data);
  },

  deleteBranch: async (id: string) => {
    await branchService.getBranchById(id);
    return branchRepository.delete(id);
  },

  toggleStatus: async (id: string, isActive: boolean) => {
    await branchService.getBranchById(id);
    return branchRepository.toggleStatus(id, isActive);
  },
};