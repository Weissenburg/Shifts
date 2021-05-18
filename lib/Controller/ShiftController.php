<?php


namespace OCA\Shifts\Controller;

use OCA\Shifts\AppInfo\Application;
use OCA\Shifts\Service\ShiftService;
use OCA\Shifts\Settings\Settings;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\DataResponse;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IRequest;
use OCP\IGroupManager;

class ShiftController extends Controller {
	/** @var ShiftService */
	private $service;

	/** @var string */
	private $userId;

	/** @var IGroupManager */
	private $groupManager;

	/** @var Settings */
	private $settings;

	use Errors;


	public function __construct(IRequest $request,IGroupManager $groupManager, ShiftService $service, Settings $settings, $userId){
		parent::__construct(Application::APP_ID, $request);
		$this->service = $service;
		$this->userId = $userId;
		$this->groupManager = $groupManager;
		$this->settings = $settings;
	}

	/**
	 * @NoAdminRequired
	 * @NoCSRFRequired
	 *
	 * @return DataResponse
	 */
	public function index(): DataResponse {
		return new DataResponse($this->service->findAll());
	}

	/**
	 * @NoAdminRequired
	 *
	 * @param int $id
	 * @return DataResponse
	 */
	public function show(int $id): DataResponse {
		return $this->handleNotFound(function () use($id){
			return $this->service->find($id);
		});
	}

	/**
	 * @NoAdminRequired
	 *
	 * @param string $analystId
	 * @param int $shiftTypeId
	 * @param string $date
	 * @return DataResponse
	 */
	public function create(string $analystId, int $shiftTypeId, string $date): DataResponse {
		return new DataResponse($this->service->create($analystId, $shiftTypeId, $date));
	}

	/**
	 * @NoAdminRequired
	 *
	 * @param int $id
	 * @param string $analystId
	 * @param int $shiftTypeId
	 * @param string $date
	 * @return DataResponse
	 */
	public function update(int $id, string $analystId, int $shiftTypeId, string $date): DataResponse
	{
		return $this->handleNotFound(function() use ($id, $analystId, $shiftTypeId, $date){
			return $this->service->update($id, $analystId, $shiftTypeId, $date);
		});
	}

	/**
	 * @NoAdminRequired
	 *
	 * @param int $id
	 * @return DataResponse
	 */
	public function destroy(int $id): DataResponse
	{
		return $this->handleNotFound(function() use($id) {
			return $this->service->delete($id);
		});
	}

	/**
	 * @NoAdminRequired
	 *
	 * Fetches if current user is ShiftsAdmin
	 */
	public function getGroupStatus(): DataResponse
	{
		$adminGroup = $this->settings->getAdminGroup();
		return new DataResponse($this->groupManager->isInGroup($this->userId, $adminGroup));
	}

	private function getHighestSkillGroupByUserId(string $userId = '')
	{
		if (empty($userId)) {
			$userId = $this->userId;
		}
		$skillGroups = $this->settings->getSkillGroups();

		foreach (array_reverse($skillGroups) as $skillGroup) {
			if ($this->groupManager->isInGroup($userId, $skillGroup['name'])){
				return $skillGroup['id'];
			}
		}
		return $skillGroups[0]['id'];
	}

	/**
	 * @NoAdminRequired
	 *
	 * Fetches list of all Analysts
	 */
	public function getAllAnalysts(): DataResponse
	{
		$groupName = $this->settings->getShiftWorkerGroup();
		$group = $this->groupManager->get($groupName);
		$users = [];
		$result = $group->getUsers();
		foreach( $result as $user) {
			$id = $user->getUID();
			$name = $user->getDisplayName();
			$email = $user->getEMailAddress();
			$photo = $user->getAvatarImage(16);

			$skillGroup = $this->getHighestSkillGroupByUserId($id);

			array_push($users, [
				'uid' => $id,
				'name' => $name,
				'email' => $email,
				'photo' => $photo,
				'skillGroup' => $skillGroup,
			]);
		}
		return new DataResponse($users);
	}

	/**
	 * @NoAdminRequired
	 *
	 * Fetches list of all Analysts exlcuding current User
	 */
	public function getAnalystsExcludingCurrent(): DataResponse
	{
		$groupName = $this->settings->getShiftWorkerGroup();
		$group = $this->groupManager->get($groupName);
		$users = [];
		$result = $group->getUsers();
		foreach( $result as $user) {
			$id = $user->getUID();
			if($id !== $this->$user) {
				$name = $user->getDisplayName();
				$email = $user->getEMailAddress();
				$photo = $user->getAvatarImage(16);

				$skillGroup = $this->getHighestSkillGroupByUserId($id);

				array_push($users, [
					'uid' => $id,
					'name' => $name,
					'email' => $email,
					'photo' => $photo,
					'skillGroup' => $skillGroup,
				]);
			}
		}
		return new DataResponse($users);
	}

	/**
	 * @NoAdminRequired
	 *
	 * Fetches all Shifts by given UserId
	 *
	 * @param string $userId
	 * @return DataResponse
	 */
	public function getShiftsByUserId(string $userId): DataResponse
	{
		return $this->handleNotFound(function () use($userId){
			return $this->service->findById($userId);
		});
	}

	/**
	 * @NoAdminRequired
	 *
	 * Fetches the userId of Current User
	 *
	 * @return DataResponse
	 */
	public function getCurrentUserId() : DataResponse{
		return new DataResponse($this->userId);
	}

	/**
	 * @NoAdminRequired
	 *
	 * Trigger for inserting unassigned shifts
	 *
	 * @return DataResponse
	 */
	public function triggerUnassignedShifts() : DataResponse {
		$bool = $this->service->triggerUnassignedShifts();
		return new DataResponse($bool);
	}


	/**
	 * @NoAdminRequired
	 *
	 * Fetches assigned shifts
	 *
	 * @return DataResponse
	 */
	public function getAssignedShifts() : DataResponse
	{
		return $this->handleNotFound(function (){
			return $this->service->findAssignedShifts();
		});
	}
}

